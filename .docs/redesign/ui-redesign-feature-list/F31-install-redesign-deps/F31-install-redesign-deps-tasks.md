# F31 — Install redesign deps (lucide-react + Radix dropdown/tooltip): Plan + Task Breakdown

> **Feature:** F31 — Install redesign deps (lucide-react + Radix dropdown/tooltip) (Phase 0 — Foundations · Scaffolding)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** — · **PRD ref:** §3.3 (icons), §3.4 (Radix dropdown-menu), §9.2 (Radix decision), D5 (tooltip-on-disabled, scope addition)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). F31 has no dependency features.

---

## 1. F31 Recap

**Goal:** Land the icon library and the two Radix packages every downstream primitive needs, so no later feature (F35 primitives, F36 tooltip wrapper, F42 disabled-nav tooltip, F32+ icon adoption) blocks on a missing dependency.

**Ships:** Nothing user-visible. `frontend/package.json` gains `lucide-react`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`; root `package-lock.json` is updated; CI install stays green.

**Acceptance (definition of done):**
1. `lucide-react`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip` are added to `frontend/package.json` with pinned ranges; lockfile updated. (Manager command: `npm install lucide-react @radix-ui/react-dropdown-menu @radix-ui/react-tooltip -w frontend` — see D1 for the npm-vs-pnpm resolution.)
2. `import { Layers } from 'lucide-react'` resolves; `import * as DropdownMenu from '@radix-ui/react-dropdown-menu'` resolves; `@radix-ui/react-tooltip` resolves. (Verified via a transient smoke import — see D6.)
3. `npm install` and `npm run build -w frontend` succeed with **zero new peer-dep warnings** vs. the pre-install baseline.

**Edge cases to resolve up front:**
- **`@radix-ui/react-tooltip` is beyond PRD §3.4's list** (which names only `dropdown-menu`) → **Decision: add it.** Required by behavior PRD §4.5 ("Select a project first" tooltip on disabled nav) and §4.2 (health tooltip). A `disabled` button is not pointer/focus-reachable, so the F42 affordance needs a real tooltip primitive. D5 owner sign-off already given. F31 installs the package; F36 owns Provider/Portal wiring.
- **Pin majors; Radix minor bumps have broken portal behavior before** → **Decision: pin `lucide-react@^1`, `@radix-ui/react-dropdown-menu@^2`, `@radix-ui/react-tooltip@^1.2.10`; install all three in a single `npm install` so shared Radix internals dedupe to one version.** The `^1.2.10` floor is load-bearing: earlier 1.2.x (e.g. 1.2.8) crashes on React 19 hover ("Maximum update depth exceeded"); 1.2.10 ships the fix. Verify in `package-lock.json` that `@radix-ui/react-popper`, `@radix-ui/react-dismissable-layer`, `@radix-ui/primitive` each resolve to exactly one version.
- **PRD §3.3 says `rtk pnpm add`, but the repo uses npm workspaces** → **Owner question (see D1 / §3 callout):** No `pnpm-lock.yaml`/`pnpm-workspace.yaml`/`yarn.lock` exist; root `package.json` declares `"workspaces": ["frontend","backend"]` with a 351 KB root `package-lock.json`. Default: truth-on-disk wins → **npm**. Owner must confirm whether to (a) keep npm (default, in scope) or (b) migrate to pnpm (out of F31 scope, cross-cutting).

---

## 2. Codebase Analysis Summary

- **State:** Greenfield for these deps. `frontend/package.json` verified to contain **none** of `lucide-react`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`. No `@radix-ui/*` of any kind, no `components/icons/` dir, no SVG icon assets, no icon library. Existing controls use text/emoji + `aria-label` only (e.g. `frontend/src/components/TopNav.tsx:48`); modal close buttons use a `×` glyph (`Modal.tsx:60`); health indicator is a plain `<span>` dot; empty states use emoji or nothing. This is the canonical missing-dep bug F31 fixes (PRD §2.4).
- **Existing structure this feature builds on:**
  - `package.json` (root) — `"workspaces": ["frontend","backend"]`, `engines.node ">=24.0.0"`; root scripts include `build`, `typecheck`, `lint`, `test` that delegate via `-w`.
  - `package-lock.json` (root, 351 KB) — the single source of truth for resolved versions; F31 modifies it.
  - `frontend/package.json` — scripts: `dev` (`vite`), `build` (`tsc -b && vite build`), `preview`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch` (`vitest`). **No `lint` script in frontend** (ESLint is root-only); no `format`/`format:check` in frontend.
  - `frontend/tsconfig.json:10-12` — `baseUrl: "."`, `paths: { "@/*": ["./src/*"] }`, extends `../tsconfig.base.json`. **`@/` alias confirmed wired.**
  - `frontend/vite.config.ts:8-12` — `resolve.alias { '@': ... }`. Alias precondition confirmed.
  - `.nvmrc` → `24`; root `engines.node >= 24.0.0`. Node pin confirmed.
- **Prior art / partial work:** None. No half-built icon or Radix wrapper exists.
- **File paths the plan references that do NOT exist yet:** None created by F31. `frontend/src/components/ui/` does **not** exist and F31 must **not** create it (F35 owns it). No scratch/dev route exists — `frontend/src/routes/index.tsx` is the only routing surface and F31 must not touch it.
- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Node 24+ stack pins; `@/` alias convention; env-var discipline (N/A for a dep install).
  - `js-style-guide.md` — no `any`; import order external→internal→type→relative; 2-space TS / 4-space JSX; ≤100 cols; trailing commas; PascalCase component files; acronyms caps. (Mostly N/A — F31 commits no source; relevant only if smoke import temporarily touches a file.)
  - `js-testing-rules.md` — Vitest co-located tests; Testing Library priority. (N/A — F31 ships no testable surface; `npm test -w frontend` is an optional regression check only.)
  - `git-guidelines.md` — rebase-and-merge only; no merge commits; no `--squash`; `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc`; **ticket unidentifiable → omit prefix** (message-only). Commit single-line message-only for this doc; feature-code commits still need user approval.
  - `persona.md` — team reference docs live under `./docs/` family (this task doc is `.docs/redesign/...`).
- **Hidden coupling to plan for:**
  - **Lockfile + shared Radix internals dedup.** `@radix-ui/react-dropdown-menu` (2.x) and `@radix-ui/react-tooltip` (1.x) version independently at the package level but share internal deps (`@radix-ui/react-popper`, `@radix-ui/react-dismissable-layer`, `@radix-ui/primitive`, `react-context`) released in lockstep from the Radix monorepo. Mismatched resolved versions of these internals break portals (dropdown opens but clicks are no-op). Single `npm install` of both → npm dedupes to one resolved version each. **T1 verifies this in `package-lock.json`.**
  - **`Tooltip.Portal` is no longer auto-applied** in recent Radix majors — Content must be wrapped explicitly. This is F36's wiring concern, but the `^1.2.10` floor that ships the React 19 fix is F31's install concern.
  - **No umbrella `radix-ui` package** — individual scoped packages only (per `@radix-ui/react-*` convention). Do not install `@radix-ui/react-dialog` (§9.2 deferred).

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Package manager | **npm workspaces** (`npm install <pkgs> -w frontend`) | Root `package.json` declares `"workspaces": ["frontend","backend"]`; lockfile is root `package-lock.json` (351 KB); **no** `pnpm-lock.yaml` / `pnpm-workspace.yaml` / `yarn.lock` exist. **Contradicts PRD §3.3's `rtk pnpm add` — truth-on-disk wins.** Owner sign-off needed (see callout below). |
| D2 | `lucide-react` version | **`^1`** | Latest `1.21.0`; React 19 compatible, no peer friction; tree-shaken via named per-icon imports (`import { Layers } from 'lucide-react'`, Vite drops unused). 0.x→1.x was the breaking major — pin `^1`. Per spec §3.3. |
| D3 | `@radix-ui/react-dropdown-menu` version | **`^2`** | Latest `2.1.18`; React 19 peer range `^19.0` satisfied — no `--legacy-peer-deps`. Portal to `document.body` by default. Per spec §3.4 + §9.2 decision (adopt this primitive). |
| D4 | `@radix-ui/react-tooltip` version | **`^1.2.10` floor** | Latest `1.2.10`; **load-bearing floor** — earlier 1.2.x (e.g. 1.2.8) crashes on React 19 hover ("Maximum update depth exceeded"); 1.2.10 ships the fix. D5 scope addition (beyond §3.4's list). React 19 supported. |
| D5 | Radix version alignment strategy | **Single `npm install` of both Radix packages; verify shared internals dedupe** | The two primitives carry independent major numbers (2.x / 1.x) but share internal deps (`@radix-ui/react-popper`, `@radix-ui/react-dismissable-layer`, `@radix-ui/primitive`) released in lockstep. Installing together forces npm to dedupe each internal to one resolved version. Mismatched internals break portals (dropdown opens, clicks no-op). Verify in `package-lock.json`. |
| D6 | Verification path | **`npm run build -w frontend` (`tsc -b && vite build`) + `npm run typecheck -w frontend` (`tsc --noEmit`) + peer-warning diff + transient smoke import** | No scratch/dev route exists; `frontend/src/routes/index.tsx` is the only routing surface and F31 must not touch it. For a dep-only install, the build+typecheck gate is sufficient and correct. No `lint` script in frontend (root ESLint only) — note, not a blocker. Smoke import is **transient and uncommitted** (F31 ships no source; `components/ui/` is F35's). |
| D7 | Scope boundaries | **Do NOT create `components/ui/` (F35); do NOT install `@radix-ui/react-dialog` (§9.2 deferred); do NOT wire any icon into a real component (F32+); do NOT touch `Modal.tsx`'s `useModalA11y`** | Prevents scope creep into downstream features. Modal keeps `useModalA11y` per §9.2. |

> **Out of F31 scope (explicitly deferred):** `components/ui/` directory and any primitive wrappers (F35); `Tooltip.Provider`/`Tooltip.Portal` wiring (F36); `@radix-ui/react-dialog` install (§9.2 — optional/deferred, Modal keeps `useModalA11y`); wiring any `lucide-react` icon into a real component (F32+ — nav, F33 — buttons, etc.); any CSS token additions (F32); any DB migration (none, per the redesign's no-migration stance).

> **Owner sign-off needed (surface in chat):**
> 1. **npm vs pnpm.** PRD §3.3 specifies `rtk pnpm add`, but the repo is npm workspaces with a root `package-lock.json` and no pnpm artifacts. **Default action (in F31 scope): use npm.** If owner wants to migrate to pnpm, that is a separate cross-cutting task and out of F31 scope. Confirm before merge.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                              # root workspace — F31 touches two files only
├─ package.json                         # root — UNCHANGED (workspaces already declares frontend)
├─ package-lock.json                    # MODIFIED — adds lucide-react + 2 Radix pkgs + deduped shared internals
└─ frontend/
   └─ package.json                      # MODIFIED — +3 deps in "dependencies":
                                         #   "lucide-react": "^1"
                                         #   "@radix-ui/react-dropdown-menu": "^2"
                                         #   "@radix-ui/react-tooltip": "^1.2.10"
# NO new source files created.
# Smoke imports are verified transiently (build/typecheck), then reverted — never committed.
# frontend/src/components/ui/ does NOT exist and is NOT created by F31 (F35 owns it).
```

F31 is a pure dependency-add: the only persisted changes are three lines in `frontend/package.json`'s `dependencies` block and the corresponding lockfile entries. No module-resolution graph, runtime flow, or request lifecycle is altered.

---

## 5. Parallelization Strategy

F31 is small. It decomposes into **2 sequential tasks** — there is **no safe parallelism within this feature** (T2 consumes the lockfile T1 produces). This is a single-developer track. The batches below are presented honestly: Batch A (install) gates Batch B (verify).

### Batch dependency diagram

```
   Batch A (install)         Batch B (verify)
   ────────────────          ────────────────
        T1 ──────────────────────▶  T2
```

- **Batch A → Batch B** is a hard barrier: T2 runs `npm run build` / `typecheck` against the lockfile T1 just produced. T2 cannot start until T1's install is complete and committed to the working branch.

### Merge order rules

1. **Batch A merges first.** T1 (install + pin) lands the `package.json` + `package-lock.json` changes. Must be on `main` before Batch B branches.
2. **Batch B merges second.** T2 (verify gate) is a verification-only task — it makes **no source changes** (smoke import is transient and reverted); it records proof in §7 and may open follow-ups. T2 can rebase onto `main` containing T1.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/package.json` (M), `package-lock.json` (M) | — | — |
| **T2** | B | no files changed (transient smoke, reverted); records proof in §7 | T1 | — |

### Developer assignment tracks

- **Solo:** T1 → T2. (The only realistic track.)
- **2+ devs:** No beneficial split. F31 is too small and strictly sequential; assign one owner end-to-end.

---

## 6. Tasks

### T1 — Install the three redesign dependencies via npm workspaces and pin versions

**Batch:** A · **Depends on:** None · **Parallel with:** —

**Description:** Add the icon library and the two Radix primitives to the frontend workspace, pinning to the version floors that avoid known React 19 breakage. Use npm (D1) — not pnpm, despite PRD §3.3 — because the repo is npm-workspaces with a root lockfile. Install all three in a single command so npm dedupes shared Radix internals.

Steps:
1. Capture a pre-install peer-warning baseline (for T2 comparison):
   ```bash
   npm install 2>&1 | tee /tmp/f31-preinstall.log
   ```
   Confirm a clean install on the unmodified tree; note any pre-existing peer warnings.
2. Install the three packages into the frontend workspace:
   ```bash
   npm install lucide-react@^1 @radix-ui/react-dropdown-menu@^2 @radix-ui/react-tooltip@^1.2.10 -w frontend
   ```
   (Explicit version floors so the manifest records them even before lockfile resolution. Equivalent: bare `npm install <pkgs> -w frontend` then verify the resolved ranges in `package.json` match the floors.)
3. Verify `frontend/package.json` `dependencies` now contains exactly:
   ```json
   "lucide-react": "^1",
   "@radix-ui/react-dropdown-menu": "^2",
   "@radix-ui/react-tooltip": "^1.2.10"
   ```
   (Caret floors acceptable; the lockfile pins exact resolved versions.)
4. Verify root `package-lock.json` was updated (timestamp / diff shows the three packages plus transitives).
5. **Shared-internals dedup check** (load-bearing, per D5): in `package-lock.json`, confirm each of these resolves to **exactly one** version (no duplicate entries under different node_modules paths):
   - `@radix-ui/react-popper`
   - `@radix-ui/react-dismissable-layer`
   - `@radix-ui/primitive`
   - `@radix-ui/react-context`
   ```bash
   # Expect exactly one version per package:
   node -e "const l=require('./package-lock.json'); const want=['@radix-ui/react-popper','@radix-ui/react-dismissable-layer','@radix-ui/primitive','@radix-ui/react-context']; for(const p of want){const vs=new Set(); for(const k of Object.keys(l.packages)){if(k.endsWith('/'+p)){vs.add(l.packages[k].version)}} console.log(p, vs.size===1?'OK':'DUP', [...vs])}"
   ```
   Any `DUP` → re-run install; if still duplicated, `npm dedupe`. Do not proceed to T2 with duplicated internals.

**Acceptance Criteria:**
- [ ] `npm install <pkgs> -w frontend` exits 0.
- [ ] `frontend/package.json` lists `lucide-react@^1`, `@radix-ui/react-dropdown-menu@^2`, `@radix-ui/react-tooltip@^1.2.10`.
- [ ] Root `package-lock.json` updated with the three packages + transitives.
- [ ] Dedup check passes: each shared Radix internal resolves to exactly one version (script prints `OK` for all four).
- [ ] No `@radix-ui/react-dialog` accidentally pulled in (not a transitive of these three — verify its absence if uncertain).

**Dependencies:** None.

---

### T2 — Verify install green: build + typecheck + peer-warning check + transient smoke import

**Batch:** B · **Depends on:** T1 · **Parallel with:** —

**Description:** Prove the three packages resolve and compile cleanly without committing any source. F31 ships no files; the smoke import is **transient** — created, type-checked, then deleted so it never lands in `main`. The gate is build + typecheck + zero-new-peer-warnings.

Steps:
1. **Peer-warning diff** — re-run install and compare to T1's `/tmp/f31-preinstall.log`:
   ```bash
   npm install 2>&1 | tee /tmp/f31-postinstall.log
   diff <(grep -i 'warn' /tmp/f31-preinstall.log) <(grep -i 'warn' /tmp/f31-postinstall.log)
   ```
   Empty diff (or only pre-existing warnings) → pass. Any **new** peer warning → investigate before proceeding.
2. **Transient smoke import** — create a throwaway `.ts` file that imports the three packages, run typecheck, then delete it. Concrete approach:
   ```bash
   cat > frontend/src/__f31_smoke.ts <<'EOF'
   import { Layers } from 'lucide-react'
   import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
   import * as Tooltip from '@radix-ui/react-tooltip'
   // Reference the symbols so the import is retained for tsc:
   void Layers
   void DropdownMenu
   void Tooltip
   EOF
   npm run typecheck -w frontend      # must exit 0
   rm frontend/src/__f31_smoke.ts     # DELETE — must not be committed
   ```
   Confirm `frontend/src/__f31_smoke.ts` is **gone** (`git status` clean of it) before moving on. This proves resolution without polluting the tree or creating `components/ui/`.
3. **Build gate:**
   ```bash
   npm run build -w frontend          # tsc -b && vite build — must exit 0
   ```
4. **Typecheck gate (clean tree, no smoke file):**
   ```bash
   npm run typecheck -w frontend      # tsc --noEmit — must exit 0
   ```
5. **Optional regression** (vitest; F31 ships no test, but confirm the suite isn't broken by the dep bump):
   ```bash
   npm run test -w frontend           # vitest run — exit 0
   ```
6. Record resolved versions from the lockfile for §7:
   ```bash
   node -e "const l=require('./package-lock.json'); for(const p of ['lucide-react','@radix-ui/react-dropdown-menu','@radix-ui/react-tooltip']){const k='node_modules/'+p; console.log(p, l.packages[k]?.version)}"
   ```

**Acceptance Criteria:**
- [ ] Peer-warning diff is empty (zero new warnings vs. pre-install baseline).
- [ ] Transient smoke import: `typecheck` resolves `Layers`, `DropdownMenu`, `Tooltip` imports; smoke file deleted; `git status` shows no `__f31_smoke.ts`.
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] (Optional) `npm run test -w frontend` exits 0.
- [ ] Resolved versions recorded for §7 (all three match the pinned floors or newer within `^`).

**Dependencies:** T1.

---

### T3 — Integration verification & sign-off

**Batch:** B (terminal) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** The final definition-of-done gate. Re-run the verification suite against the as-merged state (T1's lockfile + `package.json` on the branch), confirm no source files were committed beyond the manifest + lockfile, and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** two files:
   ```bash
   git diff --name-only main...HEAD
   # Expected:
   # frontend/package.json
   # package-lock.json
   ```
   Any other path (e.g. `frontend/src/__f31_smoke.ts`, `frontend/src/components/ui/`) → the smoke file leaked; remove and re-commit before sign-off.
2. Re-run the full gate on the merged state:
   ```bash
   npm install                                        # clean install from updated lockfile
   npm run build -w frontend                          # exit 0
   npm run typecheck -w frontend                      # exit 0
   ```
3. Re-confirm the shared-internals dedup from T1 still holds on the merged lockfile.
4. Capture resolved versions and exit codes into §7's integration record.
5. Confirm the **owner sign-off (D1: npm vs pnpm)** has been resolved before merge. If owner chose pnpm migration, stop — that is out of F31 scope and a new task is required.

**Acceptance Criteria:**
- [ ] Committed diff is exactly `frontend/package.json` + `package-lock.json` (no source files).
- [ ] `npm install` (clean) exits 0 with no new peer warnings.
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] Shared Radix internals still deduped (one version each).
- [ ] All three F31 §1 acceptance bullets satisfied; resolved versions + SHAs recorded in §7.
- [ ] Owner sign-off on D1 (npm) recorded.

**Dependencies:** T1, T2.

---

## 7. Final F31 Acceptance Checklist

- [ ] `frontend/package.json` lists `lucide-react@^1`, `@radix-ui/react-dropdown-menu@^2`, `@radix-ui/react-tooltip@^1.2.10` in `dependencies`.
- [ ] Root `package-lock.json` updated; shared Radix internals (`@radix-ui/react-popper`, `@radix-ui/react-dismissable-layer`, `@radix-ui/primitive`, `@radix-ui/react-context`) each resolve to exactly one version.
- [ ] All three packages import-resolve (transient smoke passed, file deleted, no committed source).
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] Zero new peer-dep warnings vs. pre-install baseline.
- [ ] Committed diff is exactly two files: `frontend/package.json`, `package-lock.json`.
- [ ] `components/ui/` was **not** created (F35 scope preserved).
- [ ] `@radix-ui/react-dialog` was **not** installed (§9.2 deferred scope preserved).
- [ ] Owner sign-off recorded for D1 (npm workspaces, truth-on-disk).

**Integration record (fill during T3):**
- Feature commit SHA: `________`
- Resolved versions — `lucide-react`: `________` · `@radix-ui/react-dropdown-menu`: `________` · `@radix-ui/react-tooltip`: `________`
- Shared internals dedup: `@radix-ui/react-popper` `________` · `@radix-ui/react-dismissable-layer` `________` · `@radix-ui/primitive` `________`
- Build / typecheck exit codes: `0 / 0`
- Peer-warning diff: `empty` (confirm)

---

## 8. Schema deltas owned by this feature

F31 owns no schema deltas — it is a frontend dependency install only. No DB migration, no CSS token additions (those are F32). This aligns with the redesign's standing "No DB migration" stance: F31 touches only `frontend/package.json` and the root `package-lock.json`.
