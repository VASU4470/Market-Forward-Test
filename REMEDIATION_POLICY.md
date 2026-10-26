# Priority 3 remediation policy (defined before implementation)

Scope: audited commit `d450e3fdf8485558906a42142882fc50f7f686af`. These are review-branch changes only. No production migration, deployment, collector execution, Actions activation, credential change or live data write is authorized.

## Forecast deadlines and provenance

The cutoff is the applicable exchange session's **opening instant**, exclusive: server receipt strictly before open is timely; receipt at or after open is late. The database uses its wall clock at insertion, not the browser timestamp or transaction start. Dates are interpreted in `indices.timezone` (currently Asia/Kolkata); trusted dated session windows cover holidays and special/weekend sessions. UTC and local representations of the same instant have identical eligibility.

Only an authenticated live submission with a trusted, dated, explicitly open session, a matching exchange timezone and server receipt before that opening may enter verified statistics/rankings. Calendar entries must have been recorded before that opening; adding a calendar later never promotes an older prediction. Service-role calendar provisioning is a separate reviewed operation, not automatic activation of collection. Missing/unavailable calendars fail closed for verification, while retaining local/manual and historical functionality. Explicit holiday entries are never eligible.

At submission, a server with its existing database service-role and analytics credentials can resolve a missing dated calendar from the provider's timings/holiday endpoints. It stores the first attested window via a restricted RPC; it never starts collection or retrieves price candles. Cached calendar rows avoid repeat provider requests. Without these prerequisites, forecasts are retained unverified. Test execution uses only mocked provider/database calls.

Imports are always historical, even if their browser lock time claims otherwise. All pre-migration predictions are conservatively `legacy_unverified`: their timestamps alone cannot prove the original session calendar or forward-test provenance. Existing records, IDs, predictions, scores, score versions/timestamps and test periods are preserved. Late, imported and unverified forecasts may retain/receive historical descriptive scores but never contribute to verified aggregates. History remains available with provenance labels. No client can write or change eligibility, deadline, server receipt or provenance after insertion.

New imports also carry immutable, owner-private `import_metadata`: the original local lock timestamp, score, actual result and client ID. These are archival assertions, never authoritative grade inputs or eligibility evidence. Browser history preserves the original local grade separately from any server-generated historical grade. A conflict whose existing record lacks that archive remains pending rather than pretending that synchronization preserved the original score.

The existing one-user/index/date unique key remains. A duplicate is acknowledged only after matching immutable forecast values and test-period identity against the server record. A conflicting prediction remains locally recoverable and explicitly unresolved. Original local lock times are preserved as local provenance, never used as verification evidence.

## Synchronization

Persist a browser prediction and its local test-period association before any request. Persist failures and retry on sign-in, browser online events, and a bounded periodic timer. Persist and reconcile test-period creation/closure before dependent predictions. A previous period's closure must resolve before creating a replacement. HTTP 400 is failure; HTTP 409 is not success without an equivalent server row. Missing POST representations and incomplete GET arrays are not acknowledgements. Merge server records into current storage rather than replacing local arrays or stale snapshots; preserve unsynchronized records, scores and local test IDs. Do not replay local records across accounts.

The 1–365-session selection, existing controls and local/manual fallback stay unchanged. Verified scoring eligibility is separate from retaining historical test progress.

## Collector identity and destinations

JWT header/payload must be JSON objects, with strict field types, finite numeric timestamps, RS256 and a string key ID. Reject malformed tokens, invalid lifetimes and signatures with the same safe authorization failure. A GitHub identity may live at most ten minutes, with at most 60 seconds future clock skew. Refresh a cached JWKS once on an unknown key ID with a bounded cooldown to prevent refresh floods; failures reject the token, never bypass authentication. Retain a previously valid cache only for its original lifetime.

Acquire a fresh workflow OIDC token immediately before each collector batch (a request is bounded at 180 seconds), rather than reuse one across ten batches. Only HTTPS, the exact approved hostname `market-forward-test.onrender.com`, port 443/default, and `/api/v1/internal/market-collect` are accepted; no credentials, query, fragment or redirects. Changes to the workflow file are code for review, not changes to live Actions variables, schedule activation or service settings.

## Market-candle reconciliation

For each field, tolerance is `max(0.05 index points, abs(daily field) × 0.00001)` (ten parts per million). Compare the first intraday open, maximum intraday high, minimum intraday low and final intraday close with their daily counterparts. The provider daily close remains authoritative when the difference is within tolerance; never substitute the last intraday close. Exact time coverage, finite positive prices and candle ordering/ranges remain required. This is a consistency acceptance policy, not a claim about provider entitlements or guaranteed final publication.

Outside-tolerance differences are genuine inconsistencies: do not publish a session or score predictions. Atomically quarantine the leased job with a safe reason and private raw-data audit; do not automatically retry it until administrator review explicitly requeues it. Missing/incomplete data remains retryable and never creates zero scores. Enforce reconciliation again at the publication RPC boundary. Existing canonical sessions and scores remain immutable, and duplicate collection stays idempotent.
