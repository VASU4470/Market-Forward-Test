# Market Forward Test V2.6

A mobile-first PWA prototype for Indian market traders.

## Core loop
1. Create or select a profile.
2. Make a Nifty pre-market prediction.
3. Lock it before the session.
4. After the market closes, fetch the completed Nifty session automatically.
5. Generate an objective score.
6. Review personal history and skill profile.

## Current features
- Local profile/login screen
- Separate prediction history per profile
- Profile editing and profile switching
- History filters: All, Last 7, Last 30, Scored
- Profile stats: predictions, scored sessions, best score
- India Standard Time (`Asia/Kolkata`) for trading dates and lock times
- Responsive desktop/tablet/mobile layout
- Light and dark themes
- Automatic Nifty result retrieval pilot
- Manual result entry retained as a fallback

## Automatic scoring pilot
The automatic-scoring development server uses Upstox Historical Data V3 and keeps the market-data credential on the server side. The browser never receives the token.

The pilot currently uses:
- Instrument: `NSE_INDEX|Nifty 50`
- Daily candle for previous close + session OHLC
- 15-minute candles for Trend / Range / Reversal classification
- Deterministic scoring rules rather than AI judgment

See `SCORING_RULES.md` for the current rule definitions.

### Get a read-only Upstox Analytics Token
Upstox currently provides a read-only Analytics Token intended for market-data and historical-data analytics. Generate it from your Upstox Developer Apps account under the Analytics section.

Never paste the token into `app.js`, HTML, GitHub, or any public file.

### Run with automatic scoring — macOS / Linux
```bash
git pull
export UPSTOX_ANALYTICS_TOKEN='PASTE_YOUR_TOKEN_HERE'
python3 server.py
```

Then open:

```text
http://localhost:8080
```

When you open **Session Result**, the app will try to fetch the completed Nifty session and calculate the score automatically.

### Run without a market-data token
```bash
python3 server.py
```

The app will explain that automatic market data is not configured and reveal the manual fallback.

You can also continue using the static prototype:

```bash
python3 -m http.server 8080
```

The static server does not expose the automatic `/api/market-result` endpoint.

## Important limitation of the current login
This is still a **local test profile**, not cloud authentication. Profile data is stored in browser `localStorage`.

That means:
- no password is collected
- no broker credentials are collected
- data does not automatically sync across devices
- clearing browser storage can remove local history

For public production, replace local profiles with real authentication and cloud history.

## What this version intentionally does NOT include
- Trading execution
- Portfolio access
- Options chain
- News feed
- Stock tips
- Cloud account sync

## Clone from GitHub
```bash
git clone https://github.com/VASU4470/Market-Forward-Test.git
cd Market-Forward-Test
python3 server.py
```

### VS Code
```bash
code .
```

If the `code` command is not installed on macOS, open VS Code and choose **File → Open Folder… → Market-Forward-Test**.

## Production architecture direction
Recommended next backend foundation:
- Supabase Auth for Google/email login
- PostgreSQL for cloud history
- immutable locked predictions
- one centrally published market outcome per trading session
- automatic server-side scoring for all users
- scheduled end-of-day market result ingestion

For commercial production, use market data under terms that explicitly permit the intended display, processing, and distribution. Do not rely on scraping exchange webpages.
