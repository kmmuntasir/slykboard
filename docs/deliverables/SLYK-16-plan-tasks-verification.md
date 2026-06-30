# Implementation Verification Report

**Source:** `docs/deliverables/SLYK-16-plan-tasks.md`
**Verified:** 2026-06-30T19:07:51Z
**Total Tasks:** 9 (T1–T9)
**Implemented:** 8 (89%)
**Partial:** 1
**Missing:** 0

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 8 | 8/9 (89%) |
| ⚠️ Partial | 1 | 1/9 (11%) |
| ❌ Missing | 0 | 0/9 (0%) |
| 🔄 Modified | 1 | 1/9 (11%) |

> **Note on counting:** T9 (manual live-environment verification) is **intentionally
> deferred** per the ticket owner's instruction and is the only non-Implemented task.
> It is recorded as **⚠️ Partial** (pending live-environment execution) — its
> *automatable prerequisites* (T1–T8) are all complete. T3 is also flagged 🔄
> **Modified** because it adds an explicit runtime guard beyond the strict spec, but
> this modification is a strict improvement and sanctioned by the T6 description —
> see Detailed Gap Analysis.

---

## Task-by-Task Results

### ✅ Implemented Tasks

| Task ID | Title | Files |
|---------|-------|-------|
| T1 | Remove the deprecated global `reportRouter` | `backend/src/routes/report.routes.ts` |
| T2 | Unmount `/api/reports` | `backend/src/index.ts` |
| T4 | Strip deprecated global-report test cases + add 404 regression | `backend/src/routes/report.routes.test.ts` |
| T5 | Remove deprecated global-report rows from the permission matrix | `backend/src/routes/permissionMatrix.routes.test.ts` |
| T6 | New service-level test `reportService.test.ts` (projectId required + forwarded) | `backend/src/services/reportService.test.ts` (NEW) |
| T7 | Frontend regression grep (no global endpoint reference) | `frontend/src/**` (read-only, verified) |
| T8 | Backend build + full test suite green | `backend/` (`tsc` + `vitest run`) |

### ⚠️ Partial Tasks

| Task ID | Title | Missing | Notes |
|---------|-------|---------|-------|
| T9 | Manual verification checklist (acceptance criteria) | Live-environment execution of the 5-step checklist | **Intentionally deferred** per ticket owner. All automated prerequisites (T1–T8) complete and green. Must be executed against a running BE+FE with seeded data before final production sign-off. |

### ❌ Missing Tasks

*(none)*

### 🔄 Modified Tasks

| Task ID | Title | Changes |
|---------|-------|---------|
| T3 | Tighten `reportService` — make `projectId` required, delete global branches | In addition to the spec'd signature tightening + branch deletions, both `getTimeReport` and `getTicketSummary` gained an explicit runtime guard `if (!args.projectId) throw new Error('projectId is required')`. This is **sanctioned** by the T6 description ("explicit guard → assert its shape") and is a strict security improvement. No T3 acceptance criterion is violated; behavior is unchanged for all valid (project-scoped) callers. |

---

## Detailed Gap Analysis

### Backend Gaps

**T1 — `report.routes.ts`:** ✅ No gaps.
- `grep "reportRouter"` → 0 hits (entire `backend/src`).
- `grep "requirePlatformAdmin"` in file → 0 hits; import removed.
- `projectReportsRouter` (both `/time` and `/tickets` handlers) and `parseReportQuery` byte-identical.
- No `[DEPRECATED]` / `console.warn` residue; global comment block gone.
- `requirePlatformAdmin` middleware file unchanged (still used in `users.routes.ts`, `projects.routes.ts`).

**T2 — `index.ts`:** ✅ No gaps.
- `grep "api/reports"` → 0 hits; `grep "reportRouter"` → 0 hits.
- Import binding removed (line ends at `commentsRouter`); `app.use('/api/reports', …)` mount deleted.
- `app.use('/api/projects', projectsRouter)` unchanged.

**T3 — `reportService.ts`:** ✅ Spec satisfied; 🔄 beneficial addition noted above.
- `getTimeReport` signature: `projectId: string` (required).
- `getTicketSummary` signature: `projectId: string` (required).
- `grep "args.projectId ?"` → 0 hits; `grep "withoutProject"` → 0 hits.
- Time path: unconditional `const query = withProject();`; literal `eq(tickets.projectId, args.projectId)`.
- Ticket path: single-project `projects.columns` lookup unconditional; no global Done-column scan; literal `eq(tickets.projectId, args.projectId)`.
- No `project_members` join added (out-of-scope respected).
- **Modified:** explicit runtime guard added — see 🔄 table.

**T4 — `report.routes.test.ts`:** ✅ No gaps.
- Old global describes (`GET /api/reports/time`, `GET /api/reports/tickets`, `F23/F24` header) removed.
- New `describe('SLYK-16: removed global report routes return 404', …)` present — table-driven, 4 assertions (2 paths × MEMBER + PLATFORM_ADMIN), each also asserting `mockedGetTimeReport`/`mockedGetTicketSummary` not called.
- Scoped describes (`:132`, `:232`) preserved verbatim.

**T5 — `permissionMatrix.routes.test.ts`:** ✅ No gaps.
- `// --- Reports ---` section comment retained.
- Global `/api/reports/{time,tickets}` `PA_ONLY` rows deleted.
- Scoped `MEMBER_PLUS` rows (`/api/projects/:slug/reports/{time,tickets}`) preserved.
- No other matrix row touched.

**T6 — `reportService.test.ts` (NEW):** ✅ No gaps.
- File exists, co-located next to the service.
- DB client mocked at edge (`vi.mock('../db/client', …)`); no `app`/supertest, no live DB.
- Table-driven `it.each(CASES)` covers both `getTimeReport` and `getTicketSummary` for `projectId` forwarding (asserts `'p1'` appears in collected bound values; dedicated tickets-chain WHERE assertion).
- `it.each(MISSING)` asserts both functions reject omitted/`undefined` `projectId` (`rejects.toThrow(/projectId is required/)`) and that no `.where()` ran (guard fires first).
- Commented-out compile-time guard example present at footer.
- *Cosmetic only:* a few comment em-dashes render as mojibake (`â`) — non-functional.

**T8 — Build + test gate:** ✅ SLYK-16 scope fully green.
- `npm run build` (`tsc -p tsconfig.json`) → **clean** (zero errors).
- `npx vitest run` over the three SLYK-16 test files → **168/168 passed**:
  - `src/routes/permissionMatrix.routes.test.ts` (147 tests).
  - `src/routes/report.routes.test.ts` (14 tests, incl. the new 404 regression — `/api/reports/time` and `/api/reports/tickets` both returned 404 for member + PA in the observed request log).
  - `src/services/reportService.test.ts` (7 tests).
- No `.skip` / `.todo` in the report/matrix files.
- **Pre-existing repo gap (NOT a SLYK-16 regression):** running the *full* `npm test` suite fails in `src/db/db.test.ts` — a live-PostgreSQL integration test (`column "display_name" of relation "Users" does not exist`, plus an unrelated `data_type` assertion) requiring a migrated database. This is an environment/migration-drift issue independent of SLYK-16 (SLYK-16 touches no schema, no `db.test.ts`). All SLYK-16-touched tests pass.
- **CI workflow (T8 step 4):** ⚠️ There is **no hosted GitHub Actions / CI workflow** in the repo (`.github/` does not exist). The de-facto merge gate is `scripts/merge-gate.sh` (`make gate`), which runs `npm run build -w backend && npm run test -w backend` — **identical npm scripts** to the local T8 commands. `backend/package.json` test script is `vitest run` (non-watch). `backend/vitest.config.ts` has no `include`/`exclude`/`testNamePattern`/`reporters` filters, so the new 404 block and `reportService.test.ts` are always discovered. The acceptance criterion "CI commands match local verification" is satisfied *via the merge-gate equivalence*; if the team expects a real hosted CI workflow, that is a pre-existing repo gap outside SLYK-16's scope.

### Frontend Gaps

**T7 — Frontend grep verification:** ✅ No gaps. All 4 acceptance criteria pass.
1. `grep -rn 'api/reports' frontend/src` → single hit, the **module import** `@/api/reports` in `frontend/src/hooks/useReport.ts:3` (filename, not endpoint). Zero global-endpoint request paths.
2. `frontend/src/api/reports.ts:14` — `fetchTimeReport` → `` `/projects/${projectSlug}/reports/time?…` ``; `:26` — `fetchTicketSummary` → `` `/projects/${projectSlug}/reports/tickets?…` ``. Project-scoped exclusively.
3. `frontend/src/hooks/useReport.ts:11,23` — `useReport` / `useTicketSummary` both declare `projectSlug: string` (required), threaded into both the fetch and the per-project cache key.
4. `frontend/src/pages/ReportsPage.tsx:36` reads `slug` from `useParams`; `:38-40` redirects missing-slug to `/projects`; `:48-50` maps BE 403/FORBIDDEN (`isForbidden`) to `<Navigate to="/projects" replace />`.

### Shared Gaps

- **No shared package** between BE and FE; types are hand-mirrored (`backend/src/services/reportService.ts:6-27` source of truth → `frontend/src/types/report.ts` mirror). Pre-existing, out of scope.
- **No shared constants module** (period enum duplicated as `'weekly' | 'monthly'` string-literal union on both sides). Pre-existing, out of scope.

---

## Recommendations

1. **Priority — close T9 (manual verification).** Execute the 5-step checklist in
   the plan's "Manual verification" block against a running BE+FE with seeded data:
   (1) Member 200 scoped, (2) non-member 403 byte-identical to unknown-slug 403,
   (3) Platform-Admin (non-member) 200 bypass, (4) `GET /api/reports/time` → 404,
   (5) FE Reports page loads scoped + non-member redirects to `/projects`. Until T9
   passes, do not mark SLYK-16 fully done.
2. **Non-blocking — pre-existing `db.test.ts` failure.** `npm test` (full) currently
   fails in `src/db/db.test.ts` due to DB schema drift (`display_name` column
   missing). Unrelated to SLYK-16 (no schema change). Recommend a separate ticket to
   reconcile the test DB migrations so the full suite is green for future tickets.
3. **Non-blocking — hosted CI workflow absent.** `.github/workflows/` does not exist;
   merge-gate equivalence (`make gate`) currently stands in. Recommend a separate
   ticket to add a hosted CI workflow running `npm run build` + `vitest run` to make
   the T8 step-4 acceptance criterion hold literally rather than by equivalence.
4. **Cosmetic — mojibake in comments.** A few em-dashes in `reportService.test.ts`
   comments render as `â`. Non-functional; optional cleanup.
5. **No action — T3 runtime guard.** The added `if (!args.projectId) throw` guard is
   a beneficial modification; no rework needed. Documented here for traceability.

---

## Quick Reference: Task Status

```
T1: ✅ Implemented
T2: ✅ Implemented
T3: 🔄 Modified  (spec satisfied + explicit runtime guard added — sanctioned by T6)
T4: ✅ Implemented
T5: ✅ Implemented
T6: ✅ Implemented
T7: ✅ Implemented
T8: ✅ Implemented  (SLYK-16 tests 168/168 green; tsc clean; full-suite db.test.ts failure is pre-existing/unrelated)
T9: ⚠️ Partial      (intentionally deferred — pending live-environment execution)
```
