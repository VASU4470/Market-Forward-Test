# Market Forward Test V2

A mobile-first PWA prototype for Indian market traders.

## Core loop
1. Create or select a local profile.
2. Make a Nifty pre-market prediction.
3. Lock it.
4. Enter the actual market outcome after close.
5. Get an objective score.
6. Review personal history and skill profile.

## V2 additions
- Local profile/login screen
- Separate prediction history per profile
- Profile editing and profile switching
- History filters: All, Last 7, Last 30, Scored
- Profile stats: predictions, scored sessions, best score
- Existing V1 browser history migrates into the first V2 profile
- Trading date and lock times now use India Standard Time (`Asia/Kolkata`)

## Important limitation of the current login
This is a **local test profile**, not cloud authentication. Profile data is stored in the browser with `localStorage`.

That means:
- no password is collected
- no broker credentials are collected
- data does not automatically sync across devices
- clearing browser storage can remove local history

For public production, the next backend step should replace local profiles with Supabase/Postgres authentication and cloud history.

## What this version intentionally does NOT include
- Broker connection
- Trading execution
- Portfolio access
- Options chain
- News feed
- Stock tips
- Cloud account sync

## Run locally
```bash
git pull
python3 -m http.server 8080
```
Then open http://localhost:8080

If an older PWA version is cached, refresh once after pulling the latest code. V2 uses a new service-worker cache name.

## Clone from GitHub
```bash
git clone https://github.com/VASU4470/Market-Forward-Test.git
cd Market-Forward-Test
python3 -m http.server 8080
```

### VS Code
```bash
code .
```

If the `code` command is not installed on macOS, open VS Code and choose **File → Open Folder… → Market-Forward-Test**.

## Recommended production backend
Use Supabase for:
- email/Google authentication
- user profiles
- cloud history across devices
- immutable prediction records
- admin-published market outcomes
- automated scoring for all users

For commercial production, market-result automation should use a properly licensed market-data source rather than scraping exchange pages.
