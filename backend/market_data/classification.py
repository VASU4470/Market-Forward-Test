"""Existing classification rules, shared by the pilot and authoritative collector."""
GAP_THRESHOLD = 0.0015
BIAS_THRESHOLD = 0.0020
REVERSAL_EXCURSION = 0.0035

def sorted_candles(candles):
    return sorted(candles, key=lambda c: str(c[0]))


def classify_open(open_price, prev_close):
    gap = (open_price - prev_close) / prev_close
    if gap >= GAP_THRESHOLD:
        return "Gap Up", gap
    if gap <= -GAP_THRESHOLD:
        return "Gap Down", gap
    return "Flat", gap


def classify_bias(close_price, prev_close):
    change = (close_price - prev_close) / prev_close
    if change >= BIAS_THRESHOLD:
        return "Bullish", change
    if change <= -BIAS_THRESHOLD:
        return "Bearish", change
    return "Sideways", change


def classify_day_type(open_price, high_price, low_price, close_price, intraday):
    session_range = max(high_price - low_price, 1e-9)
    body_ratio = abs(close_price - open_price) / session_range
    close_pos = (close_price - low_price) / session_range
    final_move = (close_price - open_price) / open_price

    if intraday:
        candles = sorted_candles(intraday)
        highs = [float(c[2]) for c in candles]
        lows = [float(c[3]) for c in candles]
        closes = [float(c[4]) for c in candles]
        high_idx = highs.index(max(highs))
        low_idx = lows.index(min(lows))
        max_up = (max(highs) - open_price) / open_price
        max_down = (min(lows) - open_price) / open_price

        early_close = closes[min(3, len(closes) - 1)]
        early_move = (early_close - open_price) / open_price

        prev = open_price
        path = 0.0
        for value in closes:
            path += abs(value - prev)
            prev = value
        efficiency = abs(close_price - open_price) / max(path, 1e-9)

        bullish_reversal = (
            low_idx < high_idx
            and max_down <= -REVERSAL_EXCURSION
            and final_move >= 0.001
        )
        bearish_reversal = (
            high_idx < low_idx
            and max_up >= REVERSAL_EXCURSION
            and final_move <= -0.001
        )
        early_flip = abs(early_move) >= 0.0025 and early_move * final_move < 0

        if bullish_reversal or bearish_reversal or early_flip:
            return "Reversal", {
                "bodyRatio": body_ratio,
                "closePosition": close_pos,
                "efficiency": efficiency,
                "earlyMovePct": early_move * 100,
            }

        if body_ratio >= 0.45 and efficiency >= 0.35 and (close_pos >= 0.72 or close_pos <= 0.28):
            return "Trend", {
                "bodyRatio": body_ratio,
                "closePosition": close_pos,
                "efficiency": efficiency,
                "earlyMovePct": early_move * 100,
            }

        return "Range", {
            "bodyRatio": body_ratio,
            "closePosition": close_pos,
            "efficiency": efficiency,
            "earlyMovePct": early_move * 100,
        }

    if body_ratio >= 0.55 and (close_pos >= 0.78 or close_pos <= 0.22):
        return "Trend", {"bodyRatio": body_ratio, "closePosition": close_pos, "efficiency": None}
    return "Range", {"bodyRatio": body_ratio, "closePosition": close_pos, "efficiency": None}

