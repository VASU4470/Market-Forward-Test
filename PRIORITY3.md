# Priority 3 deployment and operations

## Deployment order

1. Keep Render `MARKET_COLLECTION_ENABLED=false` during rollout (the default).
2. Review and run `supabase_phase3_schema.sql` in the Supabase SQL Editor, after
   Phase 2. It is transactional and repeatable, preserving existing scores,
   predictions, profiles and 1–365-session test periods. Do not rerun older
   migrations afterward: they can restore superseded grants/functions.
3. Deploy this revision to the existing Render Python service. No additional
   paid Render service or production package dependency is introduced.
4. Configure the server variables below in Render → service → Environment.
   Paste secrets only into secret-value fields, then save/redeploy. Never put
   credentials in client code, committed files, logs, screenshots or chat.
5. Create GitHub repository secret `MARKET_COLLECTOR_TOKEN` with the SAME random
   secret used on Render. Use a password manager to generate 48+ characters.
   GitHub Actions does not need the Upstox token or Supabase service key.
6. Set GitHub repository variable `MARKET_COLLECTOR_URL` to
   `https://market-forward-test.onrender.com/api/v1/internal/market-collect`.
7. After the migration and provider permission for this hosted use are confirmed,
   set Render `MARKET_COLLECTION_ENABLED=true` and GitHub repository variable
   `MARKET_COLLECTION_ENABLED=true`. Enable Actions and manually run
   **Collect completed market sessions**. Scheduled workflows use the default branch.
8. Inspect job status and verify one real completed session per index. Confirm
   all users share the same session and a repeated run leaves scores/timestamps
   unchanged. Local tests do not establish production entitlements or licensing.

## Render environment

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Existing project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Existing public/anon key; normal user routes retain the user's JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; isolated collection RPCs and confirmed account deletion |
| `UPSTOX_ANALYTICS_TOKEN` | Server-only read-only token; renew before its one-year expiry |
| `MARKET_COLLECTION_ENABLED` | Defaults to `false`; `true` activates collection and persisted-result reads |
| `MARKET_DATA_PROVIDER` | Defaults to `upstox` |
| `MARKET_COLLECTOR_TOKEN` | Random secret, at least 32 characters; authorizes only collection |
| `MARKET_ADMIN_USER_IDS` | Comma-separated Supabase Auth UUIDs; empty disables administrator fallback |
| `UPSTOX_INSTRUMENT_NIFTY50` | Optional instrument override |
| `UPSTOX_INSTRUMENT_BANKNIFTY` | Optional instrument override |
| `UPSTOX_INSTRUMENT_FINNIFTY` | Optional instrument override |
| `UPSTOX_INSTRUMENT_SENSEX` | Optional instrument override |
| `UPSTOX_INSTRUMENT_BANKEX` | Optional instrument override |

Mappings use environment override, then `indices.provider_instrument_key`, then
the built-in default. Keys must identify spot indices on the configured exchange.

| Code | Exchange | Upstox instrument |
|---|---|---|
| NIFTY50 | NSE | `NSE_INDEX\|Nifty 50` |
| BANKNIFTY | NSE | `NSE_INDEX\|Nifty Bank` |
| FINNIFTY | NSE | `NSE_INDEX\|Nifty Fin Service` |
| SENSEX | BSE | `BSE_INDEX\|SENSEX` |
| BANKEX | BSE | `BSE_INDEX\|BANKEX` |

## Pipeline

The scheduled workflow runs twice an hour, including weekends for special
sessions and catch-up. Each call claims up to three jobs; a workflow drains up
to ten batches. Scheduling is best effort and free Render can sleep. Durable
jobs catch up after downtime. Monitor workflow runs: GitHub can disable scheduled
workflows after prolonged repository inactivity. An independent scheduler can
instead run `python3 -m backend.market_data.collector` with the server environment.

Jobs are created for pending locked predictions. Dated Upstox market timings
and holidays determine each exchange's session, including special weekends.
Missing weekday calendar data fails closed; split sessions require manual review.
Collection waits at least 30 minutes after the reported close, then requests:

- V3 historical `days/1`, including the preceding 60 calendar days.
- V3 historical `minutes/15` for past sessions; intraday `minutes/15` for today in IST.

The provider's daily candle is required. A last intraday close is never substituted.
If the daily candle is not yet published, scoring stays pending, potentially
until the next day. Upstox provides no guaranteed final-publication timestamp;
the close delay and complete candles are our acceptance policy, not a guarantee
against later provider corrections.

Normalization checks finite positive OHLC, ranges, timezone/date, exact candle
coverage (25 in a normal session), previous-close continuity and session closure.
Daily-only classification is never authoritative. Existing classification
thresholds and `p2-v1` scoring weights remain unchanged.

A service-role-only RPC inserts the result and scores every pending prediction
for that index/date in one transaction. User-requested scoring uses the same
internal calculation. The unique index/date constraint is stronger than the
provider/index/date constraint: another provider cannot create a second canonical
result. Duplicate publication returns the original session; it never replaces it.
Scores reference that session, and scored values/timestamps stay unchanged.
Historical-import eligibility is preserved; this change does not introduce new
lock-deadline rules or retroactively invalidate predictions.

Stored results include provider, instrument, date, timeframe, previous close,
OHLC, session window, fetch time/status, raw responses and methodology/calendar
audit. Raw/audit fields are server-only. Preexisting rows keep `fetch_status=legacy`.

## Failures and administrator fallback

Jobs store attempts, safe error codes, next retry time and a 20-minute lease.
Only one batch is active globally. Expired leases recover after crashes; stale
workers cannot finish newer leases. Requests are paced at one/second. HTTP 429
honors `Retry-After` (seconds or HTTP date), capped at 24 hours; exponential
backoff also caps at 24 hours. Authentication failures wait at least six hours.
Known holidays close the job without creating results. Missing data and temporary
failures remain retryable and never turn into zero scores.

Logs contain only index/date/status/error codes. `market_fetch_attempts` retains
attempt history. Repeated failures require operator investigation; expired
tokens or provider retention limits may need renewal/manual recovery.

An administrator uses their normal verified Supabase Bearer token. The server
checks their UUID against `MARKET_ADMIN_USER_IDS`, ignoring self-declared metadata.

- `GET /api/v1/admin/market-jobs`: latest 100 jobs and errors.
- `POST /api/v1/admin/market-retry`, body `{"job_id":"UUID"}`: make a job due again.
- `POST /api/v1/admin/market-result`: publish independently reviewed data after close.

Manual-result body example (illustrative prices; empty candles are rejected):

```json
{
  "index_code": "NIFTY50",
  "trading_date": "2025-09-30",
  "session_open_at": "2025-09-30T09:15:00+05:30",
  "session_close_at": "2025-09-30T15:30:00+05:30",
  "previous_daily_candle": ["2025-09-29T00:00:00+05:30",100,105,95,100,0],
  "daily_candle": ["2025-09-30T00:00:00+05:30",100,105,95,101,0],
  "intraday_candles": [],
  "reason": "Provider unavailable; reviewed authorized alternate source",
  "source_reference": "Source report reference",
  "confirmation": "PUBLISH NIFTY50 2025-09-30"
}
```

Supply all actual 15-minute candles as `[timestamp,open,high,low,close,volume]`.
The administrator attests session times and previous close if the provider's
calendar is unavailable. The server validates/classifies the data and computes
scores; supplied score fields have no effect. Audit records include administrator
UUID, reason and source reference. Existing sessions cannot be overwritten.
Ordinary users' manual UI remains local-only. Corrections to published results
require a separately reviewed, versioned reconciliation process.

## Verification and rollback

```sh
python3 -m compileall -q server.py backend tests
python3 -m unittest discover -v
node --check auto-score.js
node --check sw.js
npm ci --prefix tests --ignore-scripts
npm test --prefix tests
```

PGlite is test-only and executes actual PostgreSQL SQL/RLS with local stand-in
Auth roles. Tests cover grants, isolation, shared scoring, duplicates, immutability,
claim recovery, retries and validation. These are not live Supabase or concurrent
multi-connection stress tests.

To stop collection, disable both scheduling and Render activation flags. Do not
drop tables or restore old insert grants. Keep the API cache exclusion and grant
fix when rolling back application code. Add another provider through the
`MarketProvider` contract, factory, mapping config and job-provider allowlist;
reuse normalization/persistence/scoring. No trading, portfolio, TradingView or
direct exchange-feed functionality is included.
