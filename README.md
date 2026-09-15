# Market Forward Test V2.7

A mobile-first PWA prototype for Indian market traders.

## Core loop
1. Sign in.
2. Make a Nifty pre-market prediction.
3. Lock it before the session.
4. After the market closes, fetch the completed Nifty session automatically.
5. Generate an objective score.
6. Review personal history and skill profile.

## Current features
- Professional account/login UI
- Email / Mobile passwordless OTP authentication UI
- Local-beta fallback when Supabase is not configured
- Separate prediction history per profile
- Profile editing and profile switching in local-beta mode
- History filters: All, Last 7, Last 30, Scored
- Profile stats: predictions, scored sessions, best score
- India Standard Time (`Asia/Kolkata`) for trading dates and lock times
- Responsive desktop/tablet/mobile layout
- Light and dark themes
- Automatic Nifty result retrieval pilot
- Manual result entry retained as a fallback

## Secure authentication pilot
V2.7 includes a Supabase passwordless-auth controller.

When Supabase is configured, the login becomes:
- Email → send OTP → verify 6-digit code → sign in
- Mobile → send SMS OTP → verify 6-digit code → sign in

The browser receives only the Supabase **publishable / anon key**, which is intended for client use. Never use a Supabase service-role key in this app or expose it in browser code.

### Supabase environment variables
Run the local server with:

```bash
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
export SUPABASE_PUBLISHABLE_KEY='YOUR_PUBLISHABLE_KEY'
python3 server.py
```

For older Supabase projects, `SUPABASE_ANON_KEY` is also accepted by the dev server.

If these variables are not set, the app stays in local-beta mode and email local profiles continue to work.

### Email OTP
In Supabase Auth, enable email authentication and configure the email template to send a numeric OTP token. For public/production delivery, configure a custom SMTP provider.

### Mobile OTP
Enable Phone Auth and configure an SMS provider supported by Supabase. For an India-focused production launch, confirm the sender/template flow complies with applicable TRAI/DLT requirements.

## Automatic scoring pilot
The automatic-scoring development server uses Upstox Historical Data V3 and keeps the market-data credential on the server side. The browser never receives the token.

The pilot currently uses:
- Instrument: `NSE_INDEX|Nifty 50`
- Daily candle for previous close + session OHLC
- 15-minute candles for Trend / Range / Reversal classification
- Deterministic scoring rules rather than AI judgment

See `SCORING_RULES.md` for the current rule definitions.

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

## Current data limitation
Until cloud profile storage is added, prediction history is still mirrored into browser `localStorage` after authentication. The OTP verifies identity, but the next backend step is moving predictions/history into Supabase PostgreSQL with Row Level Security.

## What this version intentionally does NOT include
- Trading execution
- Portfolio access
- Options chain
- News feed
- Stock tips
- Full cloud account sync yet

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
Recommended backend foundation:
- Supabase Auth for email/mobile OTP and optional Google sign-in
- PostgreSQL for cloud history
- Row Level Security so users can access only their own records
- immutable locked predictions
- one centrally published market outcome per trading session
- automatic server-side scoring for all users
- scheduled end-of-day market result ingestion

For commercial production, use market data under terms that explicitly permit the intended display, processing, and distribution. Do not rely on scraping exchange webpages.
