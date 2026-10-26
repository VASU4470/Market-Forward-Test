# Staging validation checklist — not executed by this task

This checklist describes future validation under explicit staging authorization. It does not authorize production changes, collector activation, Actions enablement or secret changes. Keep all production settings untouched. Use synthetic data and a separate staging project/service; never copy real credentials into test logs.

## Preparation and migration

- [ ] Record the staging baseline revision, backup schema/data and capture row counts/hashes for predictions, scores, score versions/timestamps, periods and profiles.
- [ ] Confirm collection and scheduler enable flags remain false. Confirm this PR does not change the existing schedule/enable gate or `render.yaml`.
- [ ] Review and apply `supabase_phase3_remediation.sql` **only to the authorized staging copy after Phase 3**. Measure lock time and table/index impact with representative volume.
- [ ] Reapply it once; verify no changes to existing values/IDs/period targets and no score recomputation. Verify old grades are labeled legacy-unverified and stay privately readable.
- [ ] Verify actual anon/authenticated/service-role grants, private calendar/quarantine/archive access, immutable verification fields, and denial of direct unchecked-publication RPC calls.

## Forecasts and grades

- [ ] Populate a trusted, dated staging calendar before the session opening. Verify standard sessions, known holidays, special/weekend sessions and exchange timezone handling against approved provider/exchange sources.
- [ ] Submit immediately before, at and after opening; verify the database receipt/cutoff comparison and exclusion at the exact boundary. Client-supplied lock times and user IDs must have no authority.
- [ ] Simulate missing calendar/provider credentials/outage: retain the forecast unverified and preserve manual/local functionality. Confirm no price collector runs during calendar lookup.
- [ ] Import historical and future-dated local records: ensure neither becomes verified. Compare original lock time, grade and actual-result archive with the original local store.
- [ ] Verify that actual PostgREST INSERT/GET representations include owner, period, verification and archive fields. Test 400, 409 identical/conflicting bodies, 401/403, 429, 5xx, timeout-after-commit and partial responses.
- [ ] Confirm opted-in verified grades can rank after five scores; all late/import/legacy grades remain excluded even if their historical grade is 100. Users not opted in remain absent.

## Browser durability and periods

- [ ] Export/back up the local store. Test offline locking, reload, sign-out/in, cross-tab changes and account switching; no profile/variant/original score may disappear.
- [ ] Lose the HTTP response after the server commits, then reconnect. Verify acknowledgements match owner/values/period/archive and duplicates do not create a second forecast.
- [ ] Fail a period closure while creating a replacement. No replacement server POST may occur before closure acknowledgement. Repeat across reload and an active second tab.
- [ ] Test targets 1, 30 and 365, reject 0/366/fractions, and preserve earlier test records. A current forecast must advance only its assigned applicable test, not a future scheduled or stopped period.
- [ ] Test the IST/UTC midnight boundary for start, completion and stop dates. Confirm old active-future periods reconcile as scheduled without changing their chosen duration.
- [ ] Verify original manual grades survive migration and server hydration, separately from server historical grades. Verify local/manual result entry still works with collection disabled.
- [ ] Verify fresh PWA assets and service-worker upgrade on an existing installation; ensure `lock-fix.js` delegates to the durable handler. Inspect mobile/desktop layout without changing controls.

## Collector identity and market integrity

- [ ] Under separate authorization, test the real issuer's signatures/claims and a rotated signing key against an isolated verifier/staging service. Reproduce unknown-key refresh, unavailable JWKS and malformed tokens; none may call collection without valid authorization.
- [ ] Validate runner fresh-token-per-batch behavior and a 180s request bound. Do not run or enable the production workflow as part of this checklist. A different staging destination needs an explicit reviewed allowlist change.
- [ ] Reject non-approved hosts, HTTP, wrong ports/paths, userinfo, query/fragment and redirects without sending the collector bearer token.
- [ ] Use synthetic complete daily/intraday candles: exact tolerance boundary, just outside it, inconsistent close/high/low/open, missing/duplicate bars and special session windows.
- [ ] Verify bad data creates no canonical session or score, quarantines the claimed job atomically, keeps raw audit private and is not automatically reclaimed. Confirm stale leases cannot quarantine a newer attempt.
- [ ] Explicitly requeue a reviewed staging quarantine; confirm the audit survives. Test concurrent duplicate publication and timeout-after-commit using separate real database connections. Values, session references and score timestamps must stay idempotent.
- [ ] Verify administrator manual publication still requires authorization, complete candles and reconciliation; normal users cannot publish market sessions. Check provider licensing/entitlements independently.

## Release gate

- [ ] Record evidence for each check, current app/schema revision and unresolved limits; obtain owner review of the PR and staging results.
- [ ] Keep production deployment, Supabase/Render/Actions settings, collector activation and any historical-result correction outside this task. Local green tests alone are not a release approval.
