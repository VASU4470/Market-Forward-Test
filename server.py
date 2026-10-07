#!/usr/bin/env python3
import json
import logging
import mimetypes
import os
import posixpath
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

from backend.routes.api import handle as handle_api
from backend.market_data.api import enabled as collection_enabled

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


from backend.market_data.classification import (
    sorted_candles, classify_open, classify_bias, classify_day_type,
)


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
        return 502, {"error": "DATA_PROVIDER_ERROR", "message": "Could not reach the market-data provider."}

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
        candidate = (ROOT / clean).resolve()
        if (not candidate.is_relative_to(ROOT) or any(part.startswith('.') for part in Path(clean).parts)
            or candidate.suffix not in {'.html', '.js', '.css', '.png', '.svg', '.ico', '.webmanifest'}
            or (len(Path(clean).parts) > 1 and Path(clean).parts[0] != 'services')):
            return str(ROOT / '__not_found__')
        return str(candidate)

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def request_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return {}

    def do_POST(self):
        if self.path.startswith("/api/v1/"):
            status, payload = handle_api(self, "POST", urllib.parse.urlparse(self.path).path)
            self.send_json(status, payload)
            return
        if self.path != "/api/account/delete":
            self.send_json(404, {"error": "Not found"})
            return
        status, payload = handle_api(self, "POST", "/api/v1/account/delete")
        self.send_json(status, payload)
        return

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/v1/"):
            status, payload = handle_api(self, "GET", parsed.path)
            self.send_json(status, payload)
            return
        if parsed.path == "/api/market-result":
            if collection_enabled():
                status, payload = handle_api(self, "GET", "/api/v1/market-result")
                self.send_json(status, payload)
                return
            query = urllib.parse.parse_qs(parsed.query)
            if (query.get("index") or ["NIFTY50"])[0] != "NIFTY50":
                self.send_json(425, {"error": "RESULT_PENDING", "message": "Automatic collection is awaiting activation."})
                return
            date = (query.get("date") or [""])[0]
            status, payload = market_result(date)
            self.send_json(status, payload)
            return

        if parsed.path in ("/", "/index.html"):
            html = (ROOT / "index.html").read_text(encoding="utf-8")
            supabase_url = os.getenv("SUPABASE_URL", "").strip()
            supabase_key = (os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_ANON_KEY") or "").strip()
            auth_config = json.dumps({
                "supabaseUrl": supabase_url,
                "supabasePublishableKey": supabase_key,
            }).replace("</", "<\\/")
            html = html.replace(
                "</head>",
                f'<script>window.MFT_AUTH_CONFIG={auth_config};</script>'
                '<link rel="stylesheet" href="auto-score.css?v=2.9">'
                '<link rel="stylesheet" href="auth-v3.css?v=2.11">'
                '<link rel="stylesheet" href="accessibility.css?v=1"></head>',
            )
            html = html.replace(
                "</body>",
                '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'
                '<script src="auto-score.js?v=5"></script>'
                '<script src="result-fix.js?v=1"></script>'
                '<script src="auth-v3.js?v=2"></script></body>',
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

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/v1/"):
            status, payload = handle_api(self, "PATCH", parsed.path)
            self.send_json(status, payload)
            return
        self.send_json(404, {"error": "Not found"})

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    port = int(os.getenv("PORT", "8080"))
    token_state = "configured" if (os.getenv("UPSTOX_ANALYTICS_TOKEN") or os.getenv("UPSTOX_ACCESS_TOKEN")) else "NOT configured"
    auth_state = "configured" if (os.getenv("SUPABASE_URL") and (os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_ANON_KEY"))) else "NOT configured"
    print(f"Market Forward Test server: http://localhost:{port}")
    print(f"Upstox analytics token: {token_state}")
    print(f"Supabase account auth: {auth_state}")
    if token_state != "configured":
        print("Tip: export UPSTOX_ANALYTICS_TOKEN='your_token' for automatic scoring.")
    if auth_state != "configured":
        print("Tip: export SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to activate secure account authentication.")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
