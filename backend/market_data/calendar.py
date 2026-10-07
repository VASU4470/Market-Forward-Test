"""Use dated exchange timings, including special weekend sessions; fail closed."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .provider import DataUnavailable, SessionWindow

IST = ZoneInfo('Asia/Kolkata')


def session_window(exchange, day, timings, holidays):
    holiday = next((h for h in holidays if h.get('date') == day.isoformat()), {})
    special = [h for h in holiday.get('open_exchanges', []) if h.get('exchange') == exchange]
    if not special and exchange in holiday.get('closed_exchanges', []):
        raise DataUnavailable('NON_TRADING_DAY', 86400)
    rows = special or [r for r in timings if r.get('exchange') == exchange]
    if not rows:
        if day.weekday() >= 5:
            raise DataUnavailable('NON_TRADING_DAY', 86400)
        # Empty timings can also mean a provider outage. Retry; never infer a holiday.
        raise DataUnavailable('CALENDAR_UNAVAILABLE', 21600)
    if len(rows) != 1:
        raise DataUnavailable('UNSUPPORTED_SPLIT_SESSION', 86400)
    try:
        start = datetime.fromtimestamp(rows[0]['start_time'] / 1000, IST)
        end = datetime.fromtimestamp(rows[0]['end_time'] / 1000, IST)
        if start.date() != day or end.date() != day or end <= start:
            raise ValueError
    except (KeyError, TypeError, ValueError, OverflowError):
        raise DataUnavailable('INVALID_CALENDAR', 21600)
    return SessionWindow(start, end, {'timings': rows, 'holiday': holiday})


def require_closed(window, now, grace_minutes=30):
    available_at = window.closes_at + timedelta(minutes=grace_minutes)
    if now < available_at:
        raise DataUnavailable('MARKET_NOT_CLOSED', max(60, int((available_at - now).total_seconds())))
