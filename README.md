# Market Forward Test V1

A mobile-first PWA prototype for Indian market traders.

## Core loop
1. Make a Nifty pre-market prediction.
2. Lock it.
3. Enter the actual market outcome after close.
4. Get an objective score.
5. Track history and skill profile.

## What this V1 intentionally does NOT include
- Broker connection
- Trading execution
- Portfolio access
- Options chain
- News feed
- Stock tips
- Cloud accounts/backend

Predictions are stored in the user's browser via `localStorage`. This is ideal for product testing but not yet production multi-device persistence.

## Run locally
```bash
python3 -m http.server 8080
```
Then open http://localhost:8080

## Deploy
This is a static site, so you can deploy the folder directly to:
- Vercel
- Netlify
- Cloudflare Pages
- GitHub Pages

No build step is required.

## Production Phase 2
Replace localStorage with Supabase/Postgres for:
- user login
- cloud history
- immutable prediction records
- admin-published market outcomes
- automated scoring across all users

For commercial production, market-result automation should use a properly licensed market-data source rather than scraping exchange pages.

## Clone from GitHub
```bash
git clone https://github.com/VASU4470/Market-Forward-Test.git
cd Market-Forward-Test
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

### VS Code
```bash
code .
```

If the `code` command is not installed on macOS, open VS Code and choose **File → Open Folder… → Market-Forward-Test**.

## Current status
This is a V1 product-validation prototype. The scoring logic and user flow are functional, but market outcomes are entered manually and data is stored only in the local browser.
