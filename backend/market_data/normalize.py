import math
from datetime import datetime, timedelta

from .calendar import IST
from .classification import classify_bias, classify_day_type, classify_open
from .provider import DataUnavailable


def ohlc(row):
    try:
        values = [float(v) for v in row[1:5]]
        if len(values) != 4 or any(not math.isfinite(v) or v <= 0 for v in values):
            raise ValueError
        op, high, low, close = values
        if not low <= min(op, close) <= max(op, close) <= high:
            raise ValueError
        stamp = datetime.fromisoformat(row[0])
        if stamp.tzinfo is None:
            raise ValueError
        return stamp.astimezone(IST), values
    except (ValueError, TypeError, IndexError):
        raise DataUnavailable('INVALID_CANDLE')


def normalize(index, provider_name, instrument, day, window, raw, now):
    try:
        daily = raw['daily']['data']['candles']
        intraday = raw['intraday']['data']['candles']
        if not isinstance(daily, list) or not isinstance(intraday, list):
            raise TypeError
    except (KeyError, TypeError):
        raise DataUnavailable('INVALID_PROVIDER_RESPONSE')
    by_date = {}
    for row in daily:
        stamp, values = ohlc(row)
        if stamp.date() in by_date:
            raise DataUnavailable('DUPLICATE_DAILY_CANDLE')
        by_date[stamp.date()] = values
    if day not in by_date:
        raise DataUnavailable('DAILY_RESULT_PENDING')
    previous = sorted(d for d in by_date if d < day)
    if not previous:
        raise DataUnavailable('PREVIOUS_CLOSE_MISSING')
    previous_day = previous[-1]
    prev = by_date[previous_day][3]
    op, high, low, close = by_date[day]
    bars = sorted(((ohlc(row)[0], row) for row in intraday), key=lambda item: item[0])
    expected = []
    stamp = window.opens_at
    while stamp < window.closes_at:
        expected.append(stamp)
        stamp += timedelta(minutes=15)
    if [stamp for stamp, _ in bars] != expected:
        raise DataUnavailable('INCOMPLETE_INTRADAY')
    tolerance = max(0.05, high * 0.00001)
    for _, row in bars:
        _, (_, bh, bl, _) = ohlc(row)
        if bh > high + tolerance or bl < low - tolerance:
            raise DataUnavailable('INCONSISTENT_OHLC')
    if abs(float(bars[0][1][1]) - op) > tolerance:
        raise DataUnavailable('INCONSISTENT_OPEN')
    bias, _ = classify_bias(close, prev)
    opening, _ = classify_open(op, prev)
    day_type, metrics = classify_day_type(op, high, low, close, [r for _, r in bars])
    return {
        'index_id': index['id'], 'trading_date': day.isoformat(),
        'provider': provider_name, 'instrument_id': instrument,
        'timeframe': '1d+15m', 'previous_close': prev, 'open': op,
        'high': high, 'low': low, 'close': close,
        'actual_bias': bias, 'actual_opening': opening, 'actual_day_type': day_type,
        'session_open_at': window.opens_at.isoformat(), 'session_close_at': window.closes_at.isoformat(),
        'fetched_at': now.isoformat(), 'fetch_status': 'valid',
        'raw_market_data': raw,
        'methodology': {'version': 'p3-classification-v1', 'scoring_rule': 'p2-v1',
                        'metrics': metrics, 'intraday_count': len(bars),
                        'previous_trading_date': previous_day.isoformat(),
                        'calendar': window.audit, 'daily_close': 'provider daily candle'},
    }
