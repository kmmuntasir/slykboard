# SLYK-0220 — Mock dispatcher: onboarding + decommission scenarios

**Phase:** 0.5 — Onboarding MVP
**Type:** Tooling
**Depends on:** SLYK-0170, SLYK-0190, SLYK-0200, SLYK-0210

## Description

Extend the mock skeleton (`10-mock-dispatcher.md` Implementation order:
Phase 0.5 slice) with onboarding/decommission behavior + fixtures.

1. **Scenario engine** — implement `--scenario=<name>` loading
   `scenarios/<name>.json` and replaying scripted callbacks with `delayMs`
   sleeps. One process, one scenario.

2. **Scenarios:**
   - `happy-path.json` — onboard → onboarding event stream
     (PENDING→PROVISIONING_LXC→WIRING_GITHUB→WIRING_AGENT→WIRING_ZORAXY→
     SMOKE_TEST→LIVE) then ticket pipeline sequence (pipeline part consumed
     from Phase 1; include the fields now per `10` spec — mock ignores them
     until SLYK-0300 implements emission).
   - `decommission.json` — `/decommission` → stream DECOMMISSIONING →
     DECOMMISSIONED.

3. **Onboard handling** — verify sig, save orchestratorId, return
   `202 {orchestratorId}`; if scenario set, immediately stream
   `onboarding_event.*` callbacks to slykboard
   `POST /api/v1/internal/projects/:slug/onboarding/events` at 1s intervals,
   each signed with `X-Dispatcher-Signature`.

4. **Decommission handling** — verify sig, `202`, stream the two events.

5. **Fixtures** — add the onboarding_event fixtures from `10-mock-dispatcher.md`
   layout (`onboarding_event.*.json` for all 8 transitions).

6. **Failure injection stub** — `/admin/next-status?path=/onboard&status=500`
   control endpoint (full use exercised in SLYK-0410/0450, endpoint exists
   now).

7. **README** update: how to run each scenario + the smoke scripts.

## Acceptance criteria

- [ ] `npm run mock:dispatcher -- --scenario=happy-path`: onboard POST →
      202, then 6-7 signed callbacks hit slykboard; slykboard meta reaches
      LIVE with onboardedAt set.
- [ ] `--scenario=decommission`: decommission POST → 202, two events,
      meta reaches DECOMMISSIONED.
- [ ] Unset scenario → 202 stubs only (skeleton behavior preserved).
- [ ] All callbacks HMAC-signed; slykboard accepts (no 401s in
      slykboard logs).
- [ ] Fixtures match `10-mock-dispatcher.md` layout.

## References

- `docs/agentic-automation/10-mock-dispatcher.md` (scenario shape, layout,
  Phase 0.5 order)
- `docs/agentic-automation/09-implementation-phases.md` Phase 0.5 smoke tests

## Dependencies

- SLYK-0170 (skeleton)
- SLYK-0190, SLYK-0200, SLYK-0210 (slykboard endpoints to callback into)
