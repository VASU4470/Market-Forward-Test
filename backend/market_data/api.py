import hmac
import math
import os
import uuid
from datetime import date, datetime, timezone

from ..data.supabase_rest import select
from ..errors import ApiError
from .calendar import IST, require_closed
from .collector import collect
from .normalize import normalize
from .provider import DataUnavailable, SessionWindow
from .repository import Repository, rpc

RESULT_COLUMNS = ('id,index_id,trading_date,previous_close,open,high,low,close,actual_bias,'
                  'actual_opening,actual_day_type,provider,instrument_id,timeframe,fetch_status,fetched_at')


def enabled():
    return os.getenv('MARKET_COLLECTION_ENABLED', 'false').lower() == 'true'


def require_enabled():
    if not enabled():
        raise ApiError(503, 'COLLECTION_DISABLED', 'Automatic collection is not enabled yet.')


def require_admin(user):
    admins = {v.strip() for v in os.getenv('MARKET_ADMIN_USER_IDS', '').split(',') if v.strip()}
    if user['id'] not in admins:
        raise ApiError(403, 'ADMIN_REQUIRED', 'Administrator access required.')


def run_job(headers):
    require_enabled()
    secret = os.getenv('MARKET_COLLECTOR_TOKEN', '')
    supplied = headers.get('Authorization', '')
    if len(secret) < 32 or not hmac.compare_digest(supplied.encode(), ('Bearer ' + secret).encode()):
        raise ApiError(403, 'JOB_FORBIDDEN', 'Collector authorization required.')
    return {'results': collect()}


def find_index(user, code):
    if not isinstance(code, str) or code not in ('NIFTY50','BANKNIFTY','FINNIFTY','SENSEX','BANKEX'):
        raise ApiError(400, 'INVALID_INDEX', 'Choose a supported index.')
    rows = select('indices', user['token'], {'select': 'id,code,exchange,provider_instrument_key',
        'code': 'eq.' + code, 'is_active': 'eq.true', 'limit': '1'})
    if not rows:
        raise ApiError(400, 'INVALID_INDEX', 'Choose an active supported index.')
    return rows[0]


def market_result(user, query):
    try:
        day = date.fromisoformat(query.get('date', ''))
    except (ValueError, TypeError):
        raise ApiError(400, 'INVALID_DATE', 'Use YYYY-MM-DD.')
    index = find_index(user, query.get('index', 'NIFTY50'))
    rows = select('market_sessions', user['token'], {'select': RESULT_COLUMNS,
        'index_id': 'eq.' + index['id'], 'trading_date': 'eq.' + day.isoformat(), 'limit': '1'})
    if not rows or rows[0]['fetch_status'] not in ('valid', 'manual', 'legacy'):
        raise ApiError(425, 'RESULT_PENDING', 'The completed market result is still pending. Collection retries automatically.')
    m = rows[0]
    if any(m.get(k) is None for k in ('actual_bias','actual_opening','actual_day_type','low','high','previous_close','open','close')):
        raise ApiError(425, 'RESULT_PENDING', 'The market result is incomplete.')
    prev, op, close = float(m['previous_close']), float(m['open']), float(m['close'])
    if any(not math.isfinite(v) or v <= 0 for v in (prev, op, close)):
        raise ApiError(425, 'RESULT_PENDING', 'The market result is incomplete.')
    return {'status': 'success', 'provider': m['provider'], 'instrument': m['instrument_id'],
        'date': m['trading_date'], 'generatedAt': m['fetched_at'], 'sessionId': m['id'],
        'actual': {'bias': m['actual_bias'], 'opening': m['actual_opening'],
                   'dayType': m['actual_day_type'], 'low': m['low'], 'high': m['high']},
        'market': {'prevClose': prev, 'open': op, 'high': m['high'], 'low': m['low'], 'close': close,
                   'gapPct': round((op / prev - 1) * 100, 4),
                   'closeChangePct': round((close / prev - 1) * 100, 4)},
        'methodology': {'source': 'Persisted authoritative session', 'timeframe': m['timeframe']}}


def manual_result(user, body):
    require_enabled()
    require_admin(user)
    try:
        day = date.fromisoformat(body['trading_date'])
        code = body['index_code']
        if body.get('confirmation') != f'PUBLISH {code} {day.isoformat()}':
            raise ValueError
        reason, reference = body['reason'].strip(), body['source_reference'].strip()
        if len(reason) < 10 or len(reference) < 5 or len(reason) > 1000 or len(reference) > 1000:
            raise ValueError
        start = datetime.fromisoformat(body['session_open_at'])
        end = datetime.fromisoformat(body['session_close_at'])
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError
        if start.astimezone(IST).date() != day or end.astimezone(IST).date() != day:
            raise ValueError
        raw = {'daily': {'data': {'candles': [body['previous_daily_candle'], body['daily_candle']]}},
               'intraday': {'data': {'candles': body['intraday_candles']}}}
    except (KeyError, ValueError, TypeError, AttributeError):
        raise ApiError(400, 'INVALID_MANUAL_RESULT', 'Supply complete candles, session times, source, reason, and exact publication confirmation.')
    now = datetime.now(timezone.utc)
    window = SessionWindow(start, end, {'source': 'administrator attestation'})
    require_closed(window, now)
    index = find_index(user, code)
    # Manual data is still validated and classified on the server, never supplied as a score.
    result = normalize(index, 'manual', index['provider_instrument_key'], day, window, raw, now)
    result['fetch_status'] = 'manual'
    result['methodology'].update(administrator_id=user['id'], reason=reason, source_reference=reference)
    return Repository().publish(result)


def admin_status(user):
    require_admin(user)
    return rpc('get_market_collection_status')


def admin_retry(user, body):
    require_enabled()
    require_admin(user)
    try:
        job_id = str(uuid.UUID(body.get('job_id', '')))
    except (ValueError, TypeError, AttributeError):
        raise ApiError(400, 'INVALID_JOB', 'Supply a valid job ID.')
    rpc('retry_market_job', {'p_job_id': job_id})
    return {'retry_requested': True}
