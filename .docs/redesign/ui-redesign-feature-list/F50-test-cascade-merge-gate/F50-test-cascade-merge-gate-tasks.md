# F50 — Test-update cascade + merge gate: Plan + Task Breakdown

> **Feature:** F50 — Make "independently shippable" a verifiable claim: a documented gate (`tsc --noEmit` + `vite build` + `lint` + `prettier --check`) that every redesign PR must pass green; all snapshot/assertion breakages fixed.
> **Feature index:** [`../ui-redesign-features.md`](../ui-redesign-features.md) (lines 391-402)
> **Slug:** `SLYK` · **Depends on:** F31–F49 (all done) · **PRD ref:** §8 (Testing), implied by §7 "independently shippable" (PRD names no gate — this feature defines it)
> **Sources:** [`../ui-redesign-features.md`](../ui-redesign-features.md), [`../../ui-redesign-plan.md`](../../ui-redesign-plan.md) §8 (lines 269-279), `.claude/rules/js-testing-rules.md`, `.claude/rules/js-style-guide.md`, `Makefile`, `eslint.config.js`, `.prettierrc`, and direct codebase analysis of `frontend/src/**` + `backend/src/**`.

---

## 1. F50 Recap

**Goal:** Make "independently shippable" a verifiable claim, not a hope. Fix every test the redesign broke and enforce a green gate per phase. F50 is the catch-all gate across the F31–F49 redesign track; it owns the gate definition itself plus genuinely cross-cutting test/format/lint normalization, and **not** feature-specific test fixes (those belong in their feature).

**Ships:**
- A documented, runnable merge gate: `tsc --noEmit` (BE+FE) + `tsc -b && vite build` (FE) / `tsc -p` (BE) + `eslint --max-warnings=0` + `prettier --check` + `vitest run` (BE+FE). All five stages must pass green.
- Gate entrypoints: `scripts/merge-gate.sh` (run a stage or all), `make gate` / `make gate-<stage>` Makefile targets.
- Lint violations fixed across F31–F49-touched files (8 errors + 1 warning → 0).
- Prettier normalization across the whole `frontend/src` + `backend/src` (108 files reformatted to repo `.prettierrc`: semicolons, 2-space JS / 4-space TSX).
- Verification that the 4 PRD-§8-named test files exist and are updated for new markup (`TopNav`, `ProjectPicker`, `Modal`, `TicketAttributeForm`), plus the 7 new tests the PRD names (all confirmed present — see §4).

**Acceptance (definition of done):**
- `make gate` exits 0 (all 5 stages green).
- `eslint frontend/src backend/src --max-warnings=0` → 0 problems.
- `prettier --check` on both src trees → "All matched files use Prettier code style!"
- Every PRD-§8-named test file updated; every PRD-§8-named new test present (§4 matrix).
- No regressions: BE 515/515, FE 700/700 (counts at gate-green time).

**Edge cases / scope guards:**
- F50 is infrastructure/polish mapping to no single PRD REQ. It is justified as the implied gate the PRD's "independently shippable" claim requires.
- F50 is **not** a dumping ground. Feature-specific broken tests are fixed in their feature (F38 owns picker retry, F44 owns the two-column form, F43 owns Modal size, etc.). F50 owns only: the gate script, cross-cutting lint/prettier normalization, and the verification matrix.
- The chunk-size Vite build warning (>500 kB) is a **warning, not an error** — build exits 0. Out of scope for F50 (no manualChunks); flagged for F51/release if desired.

---

## 2. Decisions (resolved)

- **D1 — Gate stages + order.** Five stages, ordered cheapest-fail-first: `typecheck` → `build` → `lint` → `prettier` → `test`. First failure stops the gate (`set -euo pipefail` + early return). Rationale: type/build are fast and catch the bulk of regressions; tests are slowest so they run last.
- **D2 — Lint must be `--max-warnings=0`.** A green gate means zero warnings, not just zero errors. The repo's one structural warning class (`react-hooks/incompatible-library` on RHF's `watch()`) is suppressed at its single call site with a justification comment (see §5, fix #9). No project-wide rule relaxation.
- **D3 — Gate lives in `scripts/merge-gate.sh` + Makefile, not CI.** PRD §8 says "documented (e.g. in `.docs/redesign/` or CI)". A local script + `make gate` is runnable by both humans and any future CI wrapper without coupling to a CI provider. CI adoption is a follow-up (F51/release or ops), not F50.
- **D4 — Prettier normalization is repo-wide within `src/`.** 108 files had drifted from `.prettierrc` (mostly missing semicolons — files authored `semi:false`-style during F31–F49). F50 runs `prettier --write` across both `src/` trees to make the gate enforceable. These are zero-behavior-change formatting fixes (semicolons, quote style, trailing commas); type/test/lint all re-verified green after the sweep.
- **D5 — No `argsIgnorePattern: '^_'` config change.** The `@typescript-eslint/no-unused-vars` violations were fixed by removing the unused symbols (imports/params), not by widening the lint config. Keeping the config strict preserves the gate's signal.
- **D6 — Named-test matrix is verification, not creation.** All 4 PRD-§8-named files and all 7 PRD-§8-named new tests were confirmed present (created by their owning features F38/F39/F40/F43/F44/F47/F48/F49). F50 verifies; it does not re-create.
- **D7 — Build chunk-size warning is accepted.** `vite build` emits a "chunk > 500 kB" advisory; the command exits 0. Manual chunking is out of scope (deferred to F51 if the release wants it). The gate treats exit-code 0 as green.

---

## 3. Tasks (T1–T6)

### T1 — Analyze current gate state (full matrix)
**Status:** ✅ Done
- BE typecheck: green · FE typecheck: green
- BE tests: 515/515 green · FE tests: 700/700 green
- BE build: green · FE build: green (chunk-size warning only)
- Lint (`eslint frontend/src backend/src`): **8 errors + 1 warning in 8 files** (red)
- Prettier (`--check`): **108 files unformatted** (red — pre-existing drift, not F50-caused)
- Named-test matrix: see §4.

### T2 — Fix lint violations (8 errors + 1 warning → 0)
**Status:** ✅ Done — files touched:
- `backend/src/db/schema.ts` — removed unused `eq` import; dropped unused `table` param from the users `pgTable` config callback (empty object return — other callbacks in the file use `table` and were untouched).
- `backend/src/services/reportService.ts` — `withProject(projectId)` → `withProject()`; the param was unused inside the function (line 121 uses `args.projectId`, not the param).
- `frontend/src/components/ThemeProvider.tsx` — removed unused `useContext` import.
- `frontend/src/components/ui/Field.tsx` — removed unused `createElement` import.
- `frontend/src/components/ui/Tooltip.tsx` — `interface TooltipProviderProps extends X {}` → `type TooltipProviderProps = X` (empty interface extending a supertype is the `@typescript-eslint/no-empty-object-type` anti-pattern).
- `frontend/src/hooks/useHealth.test.tsx` — removed dead `// eslint-disable-next-line react/display-name` (rule not configured; the disable itself was flagged "Definition for rule not found").
- `frontend/src/hooks/useTheme.test.tsx` — `vi.fn((_q: string) => mql)` → `vi.fn(() => mql)` (the matchMedia query arg is unused by the stub).
- `frontend/src/components/TicketAttributeForm.tsx` — hoisted `watch('description')` into a `descriptionValue` const (called once, not twice in JSX), then `// eslint-disable-next-line react-hooks/incompatible-library` at the single call site with a justification. The rule fires on RHF's `watch()` unconditionally — it is an accepted RHF ↔ React Compiler limitation, not a real defect.

### T3 — Normalize prettier across src/ (108 files → all formatted)
**Status:** ✅ Done
- Ran `prettier --write "frontend/src/**/*.{ts,tsx,css}" "backend/src/**/*.ts"`. Re-formatted 108 files to `.prettierrc` (semi:true, singleQuote, trailingComma:all, 2-space JS / 4-space TSX).
- Re-verified green: typecheck (both), lint (`--max-warnings=0`), tests (BE 515/515, FE 700/700).

### T4 — Verify PRD §8 named-test matrix
**Status:** ✅ Done — all present. See §4.

### T5 — Create the gate script + Makefile targets
**Status:** ✅ Done
- `scripts/merge-gate.sh` — 5 stages (`typecheck build lint prettier test`), run-all or single-stage, color output, first-failure-stops, CI-friendly (no color when not a TTY).
- Makefile: `gate`, `gate-typecheck`, `gate-build`, `gate-lint`, `gate-prettier`, `gate-test` targets added; `.PHONY` updated; all listed in `make help`.

### T6 — Run the full gate end-to-end and confirm green
**Status:** ✅ Done — `make gate` (or `./scripts/merge-gate.sh all`) exits 0; all 5 stages PASS. See §6 for the result block.

---

## 4. PRD §8 named-test matrix (verification)

### 4 PRD-§8-named files (updated for new markup)
| File | Location | Status |
|---|---|---|
| `TopNav` | `frontend/src/components/TopNav.test.tsx` | ✅ updated (nav clusters, Reports enabled-when-project) |
| `ProjectPicker` | `frontend/src/components/ProjectPicker.test.tsx` | ✅ updated (Radix dropdown, retry, empty-state create link) |
| `Modal` | `frontend/src/components/Modal.test.tsx` | ✅ updated (portal, aria, backdrop, **size prop table-driven**, X icon) |
| `TicketAttributeForm` | `frontend/src/components/TicketAttributeForm.test.tsx` | ✅ updated (two-column layout, Create/Save submit, validation, dirty/readOnly) |

### 7 PRD-§8-named new tests
| Test | Owning feature | File | Status |
|---|---|---|---|
| Picker retry-on-error (NOT "No projects") | F38 | `ProjectPicker.test.tsx` (lines 93–105, 141+) | ✅ |
| Profile menu Sign out | F39 | `TopNav.test.tsx` | ✅ |
| `useTheme` persistence / toggle / system-follow | F34/F40 | `frontend/src/hooks/useTheme.test.tsx` | ✅ |
| Two-column form submit | F44 | `TicketAttributeForm.test.tsx` (Create ticket / Save changes) | ✅ |
| `Modal` `size` prop → correct `max-w-*` | F43 | `Modal.test.tsx` (table-driven sm/md/lg/xl + default, lines 107–133) | ✅ |
| Reports non-member → redirect to `/projects` | F49 | `frontend/src/pages/ReportsPage.test.tsx` | ✅ |
| Membership middleware (BE) | F47 | `backend/src/middleware/requireProjectMember.test.ts` (5 tests) | ✅ |

---

## 5. Fixes applied (full file list)

**Lint fixes (8 files):**
1. `backend/src/db/schema.ts` — drop unused `eq` import; drop unused `table` callback param.
2. `backend/src/services/reportService.ts` — drop unused `projectId` param from `withProject`.
3. `frontend/src/components/ThemeProvider.tsx` — drop unused `useContext` import.
4. `frontend/src/components/ui/Field.tsx` — drop unused `createElement` import.
5. `frontend/src/components/ui/Tooltip.tsx` — `interface ... extends X {}` → `type ... = X`.
6. `frontend/src/hooks/useHealth.test.tsx` — remove dead `eslint-disable react/display-name`.
7. `frontend/src/hooks/useTheme.test.tsx` — remove unused `_q` stub arg.
8. `frontend/src/components/TicketAttributeForm.tsx` — hoist `watch('description')` + justified `eslint-disable-next-line react-hooks/incompatible-library`.

**Prettier normalization (108 files):** all `frontend/src/**/*.{ts,tsx,css}` and `backend/src/**/*.ts` reformatted to `.prettierrc`.

**Gate infra (new):**
- `scripts/merge-gate.sh` (new, executable).
- `Makefile` — 6 new targets (`gate`, `gate-typecheck`, `gate-build`, `gate-lint`, `gate-prettier`, `gate-test`) + `.PHONY` update.

---

## 6. Final gate result

`./scripts/merge-gate.sh all` (== `make gate`):

```
=== typecheck ===    [typecheck] PASS
=== build ===        [build] PASS
=== lint ===         [lint] PASS
=== prettier ===     [prettier] PASS
=== test ===         [test] PASS

=== GATE GREEN (5/5 stages passed) ===
```

- BE: 34 test files, 515 tests · FE: 95 test files, 700 tests.
- Zero lint problems (`--max-warnings=0`). Zero prettier diffs.

---

## 7. Out of scope (deferred)

- **CI wiring** (GitHub Actions / Vercel preview gate) — F50 ships a locally-runnable gate; CI is a follow-up for F51/release or ops.
- **Vite manual chunking** to silence the >500 kB build advisory — accepted warning (build exits 0); revisit at F51 if desired.
- **Coverage gate** (>80% business / >70% components per `js-testing-rules.md`) — the gate runs the tests; enforcing coverage thresholds is a separate config (`vitest --coverage`) not added here.
- **A11y automated assertions** (axe/Dropdown focus-trap in-test) — PRD §8 lists a11y as a manual/keep-semantics item; the existing `useModalA11y` semantics are covered by Modal tests. A dedicated axe pass belongs to F51 visual QA.
