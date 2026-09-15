#!/usr/bin/env python3
import json
import mimetypes
import os
import posixpath
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
INDIA_TZ = ZoneInfo("Asia/Kolkata")
INSTRUMENT_KEY = "NSE_INDEX|Nifty 50"
UPSTOX_BASE = "https://api.upstox.com/v3/historical-candle"
GAP_THRESHOLD = 0.0015      # 0.15%
BIAS_THRESHOLD = 0.0020     # 0.20%
REVERSAL_EXCURSION = 0.0035 # 0.35%


def json_bytes(payload):
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def upstox_get(path):
    token = os.getenv("UPSTOX_ANALYTICS_TOKEN") or os.getenv("UPSTOX_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("TOKEN_MISSING")
    req = urllib.request.Request(
        f"{UPSTOX_BASE}/{path}",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "MarketForwardTest/0.1",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def candle_date(candle):
    return str(candle[0])[:10]


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

    # Daily-OHLC fallback if intraday candles are temporarily unavailable.
    if body_ratio >= 0.55 and (close_pos >= 0.78 or close_pos <= 0.22):
        return "Trend", {"bodyRatio": body_ratio, "closePosition": close_pos, "efficiency": None}
    return "Range", {"bodyRatio": body_ratio, "closePosition": close_pos, "efficiency": None}


def market_result(target_date):
    try:
        target = datetime.strptime(target_date, "%Y-%m-%d").date()
    except ValueError:
        return 400, {"error": "INVALID_DATE", "message": "Use YYYY-MM-DD."}

    now_ist = datetime.now(INDIA_TZ)
    if target > now_ist.date():
        return 425, {"error": "MARKET_NOT_CLOSED", "message": "That trading date has not occurred yet."}
    if target == now_ist.date() and now_ist.time() < time(16, 0):
        return 425, {"error": "MARKET_NOT_CLOSED", "message": "Automatic scoring becomes available after the NSE session is complete."}

    start = target - timedelta(days=10)
    instrument = urllib.parse.quote(INSTRUMENT_KEY, safe="")

    try:
        daily_json = upstox_get(f"{instrument}/days/1/{target.isoformat()}/{start.isoformat()}")
    except RuntimeError as exc:
        if str(exc) == "TOKEN_MISSING":
            return 503, {
                "error": "TOKEN_MISSING",
                "message": "Automatic market data is not configured on this server yet.",
            }
        raise
    except Exception as exc:
        return 502, {"error": "DATA_PROVIDER_ERROR", "message": f"Could not reach market-data provider: {exc}"}

    daily = sorted_candles(daily_json.get("data", {}).get("candles", []))
    current_index = next((i for i, c in enumerate(daily) if candle_date(c) == target.isoformat()), None)
    if current_index is None:
        return 404, {"error": "NO_TRADING_SESSION", "message": "No Nifty session was found for this date. It may be a market holiday."}
    if current_index == 0:
        return 502, {"error": "PREVIOUS_CLOSE_MISSING", "message": "Previous trading session was not returned by the provider."}

    candle = daily[current_index]
    prev_candle = daily[current_index - 1]
    open_price = float(candle[1])
    high_price = float(candle[2])
    low_price = float(candle[3])
    close_price = float(candle[4])
    prev_close = float(prev_candle[4])

    intraday = []
    try:
        intraday_json = upstox_get(f"{instrument}/minutes/15/{target.isoformat()}/{target.isoformat()}")
        intraday = intraday_json.get("data", {}).get("candles", [])
    except Exception:
        intraday = []

    opening, gap = classify_open(open_price, prev_close)
    bias, close_change = classify_bias(close_price, prev_close)
    day_type, day_metrics = classify_day_type(open_price, high_price, low_price, close_price, intraday)

    payload = {
        "status": "success",
        "provider": "Upstox Historical Data V3",
        "instrument": INSTRUMENT_KEY,
        "date": target.isoformat(),
        "generatedAt": datetime.now(INDIA_TZ).isoformat(),
        "actual": {
            "bias": bias,
            "opening": opening,
            "dayType": day_type,
            "low": low_price,
            "high": high_price,
        },
        "market": {
            "prevClose": prev_close,
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "gapPct": round(gap * 100, 4),
            "closeChangePct": round(close_change * 100, 4),
            "intradayCandles": len(intraday),
        },
        "methodology": {
            "opening": "Gap Up/Down when open differs from previous close by at least ±0.15%; otherwise Flat.",
            "bias": "Bullish/Bearish when close differs from previous close by at least ±0.20%; otherwise Sideways.",
            "dayType": "Rule-based classification using 15-minute path, excursion order, directional efficiency, candle body and close location. Falls back to daily OHLC when intraday data is unavailable.",
        },
        "metrics": day_metrics,
    }
    return 200, payload


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urllib.parse.urlparse(path)
        clean = posixpath.normpath(urllib.parse.unquote(parsed.path)).lstrip("/")
        return str((ROOT / clean).resolve())

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/market-result":
            query = urllib.parse.parse_qs(parsed.query)
            date = (query.get("date") or [""])[0]
            status, payload = market_result(date)
            self.send_json(status, payload)
            return

        if parsed.path in ("/", "/index.html"):
            html = (ROOT / "index.html").read_text(encoding="utf-8")
            html = html.replace(
                "</head>",
                '<link rel="stylesheet" href="auto-score.css?v=1"></head>',
            )
            html = html.replace(
                "</body>",
                '<script src="auto-score.js?v=1"></script></body>',
            )
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        return super().do_GET()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    token_state = "configured" if (os.getenv("UPSTOX_ANALYTICS_TOKEN") or os.getenv("UPSTOX_ACCESS_TOKEN")) else "NOT configured"
    print(f"Market Forward Test server: http://localhost:{port}")
    print(f"Upstox analytics token: {token_state}")
    print("Tip: export UPSTOX_ANALYTICS_TOKEN='your_token' before starting for automatic scoring.")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
