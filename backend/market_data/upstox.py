import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from .calendar import IST, session_window
from .provider import DataUnavailable

DEFAULT_INSTRUMENTS = {
    'NIFTY50': 'NSE_INDEX|Nifty 50',
    'BANKNIFTY': 'NSE_INDEX|Nifty Bank',
    'FINNIFTY': 'NSE_INDEX|Nifty Fin Service',
    'SENSEX': 'BSE_INDEX|SENSEX',
    'BANKEX': 'BSE_INDEX|BANKEX',
}
_lock = threading.Lock()
_last_request = 0.0


def instrument_key(index):
    code = index['code']
    if code not in DEFAULT_INSTRUMENTS:
        raise DataUnavailable('UNSUPPORTED_INDEX', 86400)
    key = os.getenv('UPSTOX_INSTRUMENT_' + code) or index.get('provider_instrument_key') or DEFAULT_INSTRUMENTS[code]
    if not key.startswith(index['exchange'] + '_INDEX|'):
        raise DataUnavailable('INVALID_INSTRUMENT_MAPPING', 86400)
    return key


def retry_seconds(value):
    try:
        seconds = int(value)
    except (ValueError, TypeError):
        try:
            seconds = int((parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            seconds = 1800
    return max(60, min(seconds, 86400))


class Upstox:
    name = 'upstox'

    def __init__(self):
        self._calendar = {}

    def get(self, path):
        global _last_request
        token = os.getenv('UPSTOX_ANALYTICS_TOKEN', '').strip()
        if not token:
            raise DataUnavailable('TOKEN_MISSING', 21600)
        # One request/second per process; durable collector lease prevents overlap.
        with _lock:
            time.sleep(max(0, 1 - (time.monotonic() - _last_request)))
            _last_request = time.monotonic()
        request = urllib.request.Request('https://api.upstox.com' + path, headers={
            'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
        })
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                result = json.load(response)
            if not isinstance(result, dict) or result.get('status') != 'success':
                raise DataUnavailable('INVALID_PROVIDER_RESPONSE')
            return result
        except urllib.error.HTTPError as error:
            # Never propagate provider bodies, URLs, request headers, or credentials.
            if error.code == 429:
                raise DataUnavailable('PROVIDER_RATE_LIMIT', retry_seconds(error.headers.get('Retry-After')))
            if error.code in (401, 403):
                raise DataUnavailable('PROVIDER_AUTH_FAILED', 21600)
            raise DataUnavailable('PROVIDER_HTTP_' + str(error.code), 3600)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            raise DataUnavailable('PROVIDER_UNAVAILABLE')

    def session(self, exchange, trading_date):
        key = (exchange, trading_date)
        if key not in self._calendar:
            day = trading_date.isoformat()
            timings = self.get('/v2/market/timings/' + day)
            holidays = self.get('/v2/market/holidays/' + day)
            if not isinstance(timings.get('data'), list) or not isinstance(holidays.get('data'), list):
                raise DataUnavailable('INVALID_CALENDAR')
            self._calendar[key] = session_window(exchange, trading_date, timings['data'], holidays['data'])
        return self._calendar[key]

    def candles(self, instrument, trading_date, now):
        key = urllib.parse.quote(instrument, safe='')
        day = trading_date.isoformat()
        start = (trading_date - timedelta(days=60)).isoformat()
        base = '/v3/historical-candle/'
        daily = self.get(f'{base}{key}/days/1/{day}/{start}')
        if trading_date == now.astimezone(IST).date():
            path = f'{base}intraday/{key}/minutes/15'
        else:
            path = f'{base}{key}/minutes/15/{day}/{day}'
        intraday = self.get(path)
        return {'daily': daily, 'intraday': intraday}
