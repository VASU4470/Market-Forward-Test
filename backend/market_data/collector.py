"""Bounded, restart-safe collection. Run via CLI or the protected scheduled endpoint."""
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone

from .calendar import require_closed
from .normalize import normalize
from .provider import DataUnavailable, provider
from .repository import Repository
from .upstox import instrument_key

log = logging.getLogger('pizero.market_data')


def collect(source=None, repository=None, now=None):
    source = source or provider()
    repository = repository or Repository()
    now = now or datetime.now(timezone.utc)
    jobs = repository.claim(source.name)
    outcomes = []
    for job in jobs:
        status, code, delay = 'success', None, 3600
        try:
            # A previous worker may have committed the result but lost its response.
            if job.get('existing_session'):
                repository.publish({'index_id': job['id'], 'trading_date': job['trading_date']})
            else:
                day = date.fromisoformat(job['trading_date'])
                window = source.session(job['exchange'], day)
                require_closed(window, now)
                key = instrument_key(job) if source.name == 'upstox' else job['provider_instrument_key']
                raw = source.candles(key, day, now)
                result = normalize(job, source.name, key, day, window, raw, now)
                # Do not silently use a stale previous close if an intervening session is missing.
                previous = date.fromisoformat(result['methodology']['previous_trading_date'])
                cursor = previous + timedelta(days=1)
                while cursor < day:
                    try:
                        source.session(job['exchange'], cursor)
                    except DataUnavailable as error:
                        if error.code != 'NON_TRADING_DAY':
                            raise
                    else:
                        raise DataUnavailable('PREVIOUS_CLOSE_MISSING')
                    cursor += timedelta(days=1)
                repository.publish(result)
        except DataUnavailable as error:
            code = error.code
            status = 'closed' if code == 'NON_TRADING_DAY' else 'retry'
            delay = max(error.retry_after, min(86400, 300 * 2 ** min(job.get('attempts', 1), 8)))
        except Exception:
            # Exception strings may contain provider request details; log only safe codes.
            status, code = 'retry', 'COLLECTOR_INTERNAL_ERROR'
        repository.finish(job, status, code, delay)
        outcome = {'index': job['code'], 'date': job['trading_date'], 'status': status, 'error': code}
        log.info(json.dumps(outcome))
        outcomes.append(outcome)
        if code in ('PROVIDER_RATE_LIMIT', 'PROVIDER_AUTH_FAILED', 'TOKEN_MISSING'):
            # The remaining leases expire and are retried by a later run.
            break
    return outcomes


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    try:
        if os.getenv('MARKET_COLLECTION_ENABLED', 'false').lower() != 'true':
            raise DataUnavailable('COLLECTION_DISABLED')
        results = collect()
        raise SystemExit(1 if any(r['status'] == 'retry' for r in results) else 0)
    except DataUnavailable as error:
        log.error(error.code)
        raise SystemExit(1)
