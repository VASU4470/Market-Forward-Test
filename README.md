# PiZero — UI update V2.9

A mobile-first PWA prototype for Indian market traders.

## Core loop
1. Sign in.
2. Make a Nifty pre-market prediction.
3. Lock it before the session.
4. After the market closes, fetch the completed Nifty session automatically.
5. Generate an objective score.
6. Review personal history and skill profile.

## User-controlled forward tests
The Forward Test page lets each browser profile choose a start date (today or later) and a target from 1 to 365 market sessions; the default remains 30. A session counts once per date when at least one prediction is locked during the test. Progress and test records are stored with that profile's local browser data. Starting another test keeps earlier predictions and the earlier test record; an active test is marked stopped after confirmation. Test settings are not yet synchronized across devices.

## Display preferences
- PiZero logo on sign-in, desktop sidebar and mobile header, plus a matching browser/app icon.
- A− / percentage / A+ controls on sign-in and in the workspace header.
- Text size: 100–150% in 10% steps; the percentage button resets to the 110% default.
- Preference stays on this browser across reloads and sign-in/sign-out, and syncs between tabs.
- Relative font sizes preserve native browser zoom; compact captions now have a 12px base minimum.

## Account setup (Supabase)

Production accounts use email and password. New users choose **Sign Up**, receive an email verification link, return to PiZero, complete personal details and a market profile, create a password, and then sign in normally. Existing users can request a password reset link. Email links must redirect to the deployed PiZero URL.

The personal form asks for a unique username, display name, preferred language, and an optional mobile number. Users can opt into public rankings. The market form offers experience, capital ranges, trading and investing interests, conditional options and investing questions, and a broker choice. These fields are stored in Supabase user metadata and the `profiles` table, and mirrored into local browser storage. PAN is not collected. Mobile and PAN KYC verification are marked “Coming soon”; mobile cannot be used for authentication. Predictions and score history remain local to each browser in this release, so the full cross-user score leaderboard requires the later cloud-history migration.

Supabase may avoid revealing whether an email exists when a verification/reset email is requested. An existing account is identified after the owner opens the email link; PiZero then offers password sign in/reset. Unverified mobile numbers cannot be checked for uniqueness.

### Deployment settings

Render environment variables:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
```

Use the publishable/anon key in the browser. The service-role key is server-only and is used only for permanent account deletion; never expose it in HTML or client JavaScript. Before deploying the profile flow, run `supabase_profile_schema.sql` once in the Supabase SQL Editor. It creates the unique username constraint, profile RLS policies, and the opt-in public-profile view. In Supabase Authentication, enable Email and set the Site URL and allowed Redirect URLs to the exact deployed origin (including `https://`). Confirm that the email template contains a working confirmation link and that password reset emails are enabled. A frontend push cannot set these dashboard values. Production fails closed with a configuration error when Supabase is absent; localhost retains the local prototype for development.

## Local profile onboarding preview

To repeatedly inspect the signup/profile screens without creating users or sending email, run `python3 server.py` and open `http://localhost:8080/?dev-test=1`. This local-only preview simulates a verified email, validates the personal details, shows the adaptive trading/investing questions, and lets you restart. It never calls Supabase and does not save a profile or password. The preview is disabled on the Render domain.

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
Until cloud profile storage is added, prediction history is still mirrored into browser `localStorage` after authentication. Email verification confirms identity, but the next backend step is moving predictions/history into Supabase PostgreSQL with Row Level Security.

## Phase 1 cloud data layer

Phase 1 adds a reusable authenticated API for profiles, data-driven indexes, and locked predictions. Before deploying the Phase 1 code, run `supabase_phase1_schema.sql` in the Supabase SQL Editor. The migration is designed to preserve existing profile rows and can be run after `supabase_profile_schema.sql`.

The browser calls `/api/v1/indices`, `/api/v1/profile`, and `/api/v1/predictions`. Protected endpoints require the Supabase access token; the server derives the user ID from that token and ignores any browser-supplied user ID. Local prediction data remains available as a temporary migration fallback until cloud storage is confirmed.

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
- Supabase Auth for verified email and password, with future KYC support
- PostgreSQL for cloud history
- Row Level Security so users can access only their own records
- immutable locked predictions
- one centrally published market outcome per trading session
- automatic server-side scoring for all users
- scheduled end-of-day market result ingestion

For commercial production, use market data under terms that explicitly permit the intended display, processing, and distribution. Do not rely on scraping exchange webpages.
