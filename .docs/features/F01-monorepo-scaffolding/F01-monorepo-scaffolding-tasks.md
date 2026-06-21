# F01 — Monorepo Scaffolding & Dev Tooling: Plan + Task Breakdown

> **Feature:** F01 — Monorepo scaffolding & dev tooling (Phase 0 — Foundation)
> **Slug:** `SLYK` · **Depends on:** — (first feature) · **PRD ref:** §5 (Tech Constraints)
> **Sources:** [`basic-PRD.md`](./basic-PRD.md), [`features.md`](./features.md) (L62–78), [`.claude/rules/js-development-rules.md`](../.claude/rules/js-development-rules.md), [`.claude/rules/js-style-guide.md`](../.claude/rules/js-style-guide.md), [`.claude/rules/js-testing-rules.md`](../.claude/rules/js-testing-rules.md), [`.claude/rules/git-guidelines.md`](../.claude/rules/git-guidelines.md)

---

## 1. F01 Recap

**Goal:** A runnable full-stack skeleton with shared conventions.

**Ships:** `npm run dev` boots a Vite React frontend and an Express backend; both respond to a health check. ESLint + Prettier + TypeScript configured end-to-end.

**Acceptance (definition of done):**
1. `frontend/` and `backend/` packages exist with the structure defined in `js-development-rules.md`.
2. Root scripts start both apps concurrently in dev.
3. `.env.example` files committed for both packages; real `.env` gitignored.
4. Lint + format pass on an empty change.

**Edge cases to resolve up front:**
- Monorepo tool: **npm workspaces** (chosen — simplest, zero extra dep, matches self-host ethos).
- Node 24+, React 19+, Express 5 — **pin versions** (`.nvmrc` + `engines` + caret ranges).
- `.gitignore` must include `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store`.

---

## 2. Codebase Analysis Summary

- **State:** Greenfield. `find` confirms repo contains only `LICENSE`, `README.md`, `project-metadata.md`, `.docs/*`, and `.claude/*`. **No source, no `package.json`, no `.gitignore`.** Nothing to preserve or migrate.
- **Authority files** this plan must satisfy:
  - `js-development-rules.md` — dictates `frontend/src/` and `backend/src/` directory layouts, API client shape, env var names, deploy targets.
  - `js-style-guide.md` — 2-space JS / 4-space JSX, 100-char lines, import order, naming.
  - `js-testing-rules.md` — **Vitest** is the mandated test runner; tests co-located (`*.test.ts`); table-driven preferred.
  - `git-guidelines.md` — rebase-and-merge only, no merge commits; branch `feature/SLYK-<n>-...`; commit `SLYK-<n>: ...`.
- **Hidden coupling to plan for:**
  - Single root ESLint flat config (ESLint 9) covers **both** packages via globs — avoids per-package lint configs.
  - One `tsconfig.base.json` shared; each package extends it.
  - ESM end-to-end (`"type": "module"` in every `package.json`) so Vite and Node align.
  - F02 (DB), F03 (API envelope/CORS), F04 (frontend shell) all build on this skeleton — do **not** bake feature logic in, but leave the seams open (env loader, config module, dir placeholders).

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Monorepo tool | **npm workspaces** | Zero extra dependency; PRD self-host ethos; sufficient for 2 packages. |
| D2 | Package manager | **npm** | Matches D1; no lockfile-format debate. |
| D3 | Module system | **ESM** (`"type": "module"`) everywhere | Vite is ESM; Node 24 fully supports it; one system, no interop. |
| D4 | Node version | **24 LTS** — `.nvmrc` `24`, `engines.node ">=24"` | Per PRD §5 / rules. |
| D5 | Frontend stack | **React 19 + Vite 7 + TypeScript + Tailwind v4** | Tailwind v4 (CSS-first, `@tailwindcss/vite` plugin). |
| D6 | Backend stack | **Express 5 + TypeScript** | TS end-to-end per F01 acceptance ("TS configured end-to-end"); dev via `tsx watch`, prod via `tsc` → `dist/`. |
| D7 | Lint | **ESLint 9 flat config**, single root `eslint.config.js` with `typescript-eslint`, glob overrides per package | One source of truth. |
| D8 | Format | **Prettier 3** shared root config; 2-space JS, 4-space JSX, 100 cols, trailing commas | Per `js-style-guide.md`. |
| D9 | Test runner | **Vitest 3** (both packages) | Mandated by `js-testing-rules.md`; wire now to avoid retrofit. |
| D10 | Concurrent dev | **`concurrently`** at root | Boots API + web, namespaced log prefixes. |
| D11 | Path alias | **`@/` → `frontend/src/`** | Set now (`vite.config.ts` + `tsconfig.json` paths) — expensive to retrofit. |
| D12 | Backend language | **TypeScript** (not plain JS) | F01 explicitly requires TS end-to-end; `js-development-rules.md` JS snippets are pattern illustrations, not a mandate. Flag for owner confirmation if they prefer CJS/JS backend. |

> **Out of F01 scope (explicitly deferred):** Dockerfiles (F29), DB client/migrations (F02), API envelope + full CORS lockdown + Zod validation (F03), routing/layout/providers (F04), Husky/`lint-staged` git hooks (optional follow-up). F01 adds **only** a minimal `GET /api/health` + permissive dev CORS so the health check is reachable.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                          # root workspace
├─ package.json                     # workspaces, engines, root scripts
├─ .nvmrc                           # 24
├─ .npmrc                           # workspace config
├─ .gitignore                       # node_modules, .env, dist, build, *.log, .DS_Store, coverage, .vite
├─ .editorconfig
├─ .prettierrc.json
├─ .prettierignore
├─ tsconfig.base.json               # shared TS compiler options
├─ eslint.config.js                 # flat, covers both packages via globs
└─ README.md                        # dev section appended
├─ frontend/
│  ├─ package.json                  # "type":"module", vite/react/tailwind/vitest scripts
│  ├─ tsconfig.json                 # extends ../tsconfig.base.json, jsx, @/ path
│  ├─ vite.config.ts                # react + tailwind plugins, @/ alias, vitest
│  ├─ index.html
│  ├─ .env.example                  # VITE_API_BASE_URL=http://localhost:3000/api
│  └─ src/
│     ├─ main.tsx                   # ReactDOM.createRoot
│     ├─ App.tsx                    # renders title + health probe
│     ├─ index.css                  # @import "tailwindcss";
│     ├─ components/                # placeholder .gitkeep
│     ├─ hooks/
│     ├─ pages/
│     ├─ api/
│     ├─ types/
│     ├─ constants/
│     ├─ utils/
│     └─ stores/
└─ backend/
   ├─ package.json                  # "type":"module", express, tsx dev, vitest
   ├─ tsconfig.json                 # extends ../tsconfig.base.json, node, outDir dist
   ├─ .env.example                  # PORT, FRONTEND_URL, DATABASE_URL (placeholder for F02)
   └─ src/
      ├─ index.ts                   # createServer, GET /api/health, graceful listen
      ├─ config/
      │  ├─ env.ts                  # typed env loader (process.env)
      │  └─ index.ts
      ├─ routes/                    # placeholder .gitkeep
      ├─ controllers/
      ├─ middleware/                # (minimal cors here for dev only)
      ├─ services/
      ├─ repositories/
      ├─ db/                        # (empty — F02 owns)
      └─ utils/
```

---

## 5. Parallelization Strategy

Tasks are grouped into **3 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
   Batch A (foundation)        Batch B (packages)        Batch C (integrate)
   ─────────────────────       ─────────────────         ───────────────────
        T1 ──┐
             ├──▶  T3 (frontend/) ──┐
        T2 ──┤                      ├──▶  T5 (verify & wire)
             ├──▶  T4 (backend/)  ──┘
```

- **Batch A** → **Batch B** is a hard barrier: T3/T4 `npm install` into workspaces the root declares.
- **Batch B** → **Batch C** is a hard barrier: T5 runs the concurrent dev server and health checks that require both packages present.

### Merge order rules

1. **Batch A merges first.** T1 and T2 may merge in either order (disjoint files). Root must be on `main` before Batch B branches start.
2. **Batch B merges second.** T3 and T4 merge independently in any order. `npm install` at root resolves both.
3. **Batch C merges last.** T5 may edit `package.json` (root scripts) and any scaffold gaps found during verification — rebase onto a `main` that already contains T1–T4.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | root: `package.json`, `.gitignore`, `.nvmrc`, `.npmrc`, `README.md` | — | T2 |
| **T2** | A | root: `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig` | — | T1 |
| **T3** | B | `frontend/**` | T1, T2 | T4 |
| **T4** | B | `backend/**` | T1, T2 | T3 |
| **T5** | C | root `package.json` (scripts confirm), scaffold gaps, verification record | T3, T4 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → (T3 ‖ T4) → T5.
- **2 devs:** Dev-A infra path `T1 → T2 → T5`; Dev-B app path owns `T3` and `T4` sequentially (or split: Dev-A `T3`, Dev-B `T4` after Batch A merges).
- **3 devs:** Dev-A `T1`+`T2`; Dev-B `T3`; Dev-C `T4`; all converge on `T5`.

---

## 6. Tasks

### T1 — Root monorepo bootstrap (npm workspaces)

**Batch:** A · **Depends on:** None · **Parallel with:** T2

**Description:** Create the root workspace manifest and repo-hygiene files. This is the contract every other task installs against.

Create:
- `package.json` (root) — `private: true`, `type: "module"`, `workspaces: ["frontend", "backend"]`, `engines.node: ">=24.0.0"`, and the **root scripts** below. Dev deps: `concurrently`, `eslint`, `prettier`, `typescript`, `typescript-eslint`.

  Root scripts:
  ```json
  {
    "dev":      "concurrently -n api,web -c blue,green \"npm:dev:api\" \"npm:dev:web\"",
    "dev:api":  "npm run dev -w backend",
    "dev:web":  "npm run dev -w frontend",
    "build":    "npm run build -w backend && npm run build -w frontend",
    "typecheck":"npm run typecheck -w backend && npm run typecheck -w frontend",
    "lint":     "eslint .",
    "format":   "prettier --write .",
    "format:check": "prettier --check .",
    "test":     "npm run test -w backend && npm run test -w frontend"
  }
  ```
- `.gitignore` — entries (per `git-guidelines.md` + F01 edge case): `node_modules/`, `.env`, `.env.*`, `!.env.example`, `dist/`, `build/`, `*.log`, `.DS_Store`, `coverage/`, `.vite/`, `*.local`, `.eslintcache`.
- `.nvmrc` → `24`.
- `.npmrc` → `save-exact=false` (caret by default), `engine-strict=true`.
- `README.md` — append a **Development** section: prerequisites (Node 24, npm), `npm install` (run at root, installs all workspaces), `npm run dev`, per-package scripts, env setup (copy `.env.example` → `.env`).

**Acceptance Criteria:**
- [ ] `package.json` declares `workspaces: ["frontend","backend"]`, `type: "module"`, `engines.node >= 24`.
- [ ] `.gitignore` contains every required entry; real `.env` ignored, `.env.example` tracked.
- [ ] `.nvmrc` pins Node 24.
- [ ] Root scripts (`dev`, `build`, `typecheck`, `lint`, `format`, `format:check`, `test`) present.
- [ ] `README.md` has a runnable Development section.
- [ ] `nvm use` resolves; `npm install` runs without error (after T3/T4 exist).

**Dependencies:** None.

---

### T2 — Shared lint / format / TypeScript tooling

**Batch:** A · **Depends on:** None · **Parallel with:** T1

**Description:** Establish the single source of truth for code style across both packages. Files live at root and are consumed by T3/T4 via extension/import.

Create:
- `tsconfig.base.json` — shared compiler options: `target: ES2023`, `module: ESNext`, `moduleResolution: Bundler`, `strict: true`, `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`, `isolatedModules`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. **No** `include`/`paths` here (packages own those).
- `eslint.config.js` (ESLint 9 **flat**) — spread `typescript-eslint` recommended; `ignores: ["**/dist/**","**/node_modules/**","**/coverage/**"]`; per-package `files` overrides:
  - **frontend** (`frontend/src/**/*.{ts,tsx}`): enable React plugin + JSX rules, hook rules.
  - **backend** (`backend/src/**/*.ts`): Node globals, no DOM.
  - Formatting concern is Prettier's, not ESLint's — do **not** add formatting rules to ESLint.
- `.prettierrc.json` — per `js-style-guide.md`: `printWidth: 100`, `tabWidth: 2`, `semi: true`, `singleQuote: true`, `trailingComma: "all"`, `arrowParens: "always"`, and an `overrides` entry forcing `tabWidth: 4` for `*.tsx`.
- `.prettierignore` — `dist/`, `build/`, `coverage/`, `node_modules/`, `pnpm-lock.yaml`, `package-lock.json`, `*.md` (optional).
- `.editorconfig` — 2-space indent, 4 for JSX, LF, UTF-8, final newline, 100 cols.

**Acceptance Criteria:**
- [ ] `eslint.config.js` is valid flat config; `npx eslint --print-config frontend/src/main.tsx` and `... backend/src/index.ts` resolve distinct rule sets.
- [ ] `tsconfig.base.json` extends cleanly from both package tsconfigs (verified in T3/T4).
- [ ] `prettier --check .` passes against the scaffold (after B).
- [ ] JSX files format with 4-space indent; `.ts`/`.js` with 2-space.
- [ ] `.editorconfig` mirrors Prettier settings.

**Dependencies:** None.

---

### T3 — Frontend scaffold (Vite + React 19 + TS + Tailwind v4 + Vitest)

**Batch:** B · **Depends on:** T1, T2 · **Parallel with:** T4

**Description:** Stand up the `frontend/` workspace exactly per `js-development-rules.md` §Project Structure. F01 scope = boots, renders, and proves a health probe; **no** routing/providers/board (those are F04).

Create:
- `frontend/package.json` — `name: "@slykboard/frontend"`, `private`, `type: "module"`. Scripts: `dev` (`vite`), `build` (`tsc -b && vite build`), `preview`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch` (`vitest`).
  Deps: `react@^19`, `react-dom@^19`. Dev deps: `vite@^7`, `@vitejs/plugin-react`, `typescript`, `tailwindcss@^4`, `@tailwindcss/vite`, `vitest@^3`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@types/react`, `@types/react-dom`.
- `frontend/tsconfig.json` — `extends: "../tsconfig.base.json"`, `jsx: "react-jsx"`, `lib: ["ES2023","DOM","DOM.Iterable"]`, `include: ["src"]`, `paths: { "@/*": ["./src/*"] }`.
- `frontend/vite.config.ts` — `react()` + `tailwindcss()` plugins; `resolve.alias { '@': path.resolve(__dirname,'./src') }`; `test` block for Vitest (`environment: 'jsdom'`, `globals: true`, `setupFiles: ['./src/test-setup.ts']`).
- `frontend/index.html` — root `<div id="root">`, `<title>Slykboard</title>`, module script `src/main.tsx`.
- `frontend/.env.example`:
  ```env
  VITE_API_BASE_URL=http://localhost:3000/api
  ```
- `frontend/src/main.tsx` — `createRoot(document.getElementById('root')!).render(<App/>)`.
- `frontend/src/App.tsx` — renders `<h1>Slykboard</h1>` + a `useEffect` that `fetch`es `${import.meta.env.VITE_API_BASE_URL}/health` and shows a green "API: ok" / red "API: down" dot. (Minimal — proper API client is F04.)
- `frontend/src/index.css` — `@import "tailwindcss";` (Tailwind v4 CSS-first).
- `frontend/src/test-setup.ts` — `import '@testing-library/jest-dom'`.
- `frontend/src/App.test.tsx` — table-driven smoke test asserting the title renders (proves Vitest + RTL wired; per `js-testing-rules.md`).
- Empty placeholder dirs with `.gitkeep`: `components/ hooks/ pages/ api/ types/ constants/ utils/ stores/`.

**Acceptance Criteria:**
- [ ] `npm install` at root installs the workspace; `npm run dev -w frontend` serves Vite at `:5173`.
- [ ] App renders "Slykboard" and, with backend running, shows "API: ok".
- [ ] `@/` alias resolves in both `vite.config.ts` and `tsconfig.json`.
- [ ] `npm run typecheck -w frontend` clean.
- [ ] `npm run test -w frontend` passes the smoke test.
- [ ] Tailwind classes compile (e.g. a `className="text-red-500"` renders styled).
- [ ] `.env.example` committed; `.env` ignored.

**Dependencies:** T1 (root workspaces + scripts), T2 (base tsconfig + shared eslint).

---

### T4 — Backend scaffold (Express 5 + TS + Vitest) + health endpoint

**Batch:** B · **Depends on:** T1, T2 · **Parallel with:** T3

**Description:** Stand up the `backend/` workspace per `js-development-rules.md` §Backend Structure. F01 scope = boots Express, serves `GET /api/health`, loads typed env, graceful shutdown. **No** DB/middleware/services logic (F02/F03).

Create:
- `backend/package.json` — `name: "@slykboard/backend"`, `private`, `type: "module"`. Scripts: `dev` (`tsx watch src/index.ts`), `build` (`tsc -p tsconfig.json`), `start` (`node dist/index.js`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch` (`vitest`).
  Deps: `express@^5`, `cors`. Dev deps: `typescript`, `tsx@^4`, `vitest@^3`, `@types/express`, `@types/cors`, `@types/node`.
- `backend/tsconfig.json` — `extends: "../tsconfig.base.json"`, `lib: ["ES2023"]`, `types: ["node"]`, `outDir: "dist"`, `rootDir: "src"`, `include: ["src"]`, `tsBuildInfoFile`.
- `backend/.env.example`:
  ```env
  PORT=3000
  FRONTEND_URL=http://localhost:5173
  # F02 fills these in:
  DATABASE_URL=
  ```
- `backend/src/config/env.ts` — a **typed config module**: read `process.env` once into a frozen object (`port: Number(process.env.PORT ?? 3000)`, `frontendUrl: process.env.FRONTEND_URL`, `nodeEnv`). Fail fast on missing required vars. (Pattern per `js-development-rules.md` "Environment Configuration"; full env set arrives per-feature.)
- `backend/src/config/index.ts` — re-export.
- `backend/src/index.ts` — create `express()` app; `app.use(cors({ origin: env.frontendUrl }))` (**dev-permissive only**; full lockdown is F03); `app.use(express.json())`; `GET /api/health` → `{ status: "ok", service: "slykboard-backend", uptime: process.uptime(), timestamp }`; listen on `env.port`; log startup; handle `SIGTERM`/`SIGINT` → `server.close()` then `process.exit(0)` (graceful, no hanging sockets — prerequisite for F02).
- `backend/src/health.test.ts` — Vitest test using `supertest` (add as dev dep) that asserts `/api/health` returns 200 + `status: "ok"` (table-driven per `js-testing-rules.md`).
- Empty placeholder dirs with `.gitkeep`: `routes/ controllers/ middleware/ services/ repositories/ db/ utils/`.

**Acceptance Criteria:**
- [ ] `npm run dev -w backend` boots on `PORT` (default 3000); logs a startup line.
- [ ] `GET http://localhost:3000/api/health` → 200 `{ status: "ok", ... }`.
- [ ] CORS allows origin `http://localhost:5173` (frontend can fetch it).
- [ ] `npm run build -w backend` emits `dist/index.js`; `npm start` serves health.
- [ ] `SIGINT` closes the server cleanly (no hanging socket).
- [ ] `npm run typecheck -w backend` and `npm run test -w backend` pass.
- [ ] `.env.example` committed; `.env` ignored; `dist/` ignored.

**Dependencies:** T1 (root workspaces + scripts), T2 (base tsconfig + shared eslint).

---

### T5 — Integration verification & dev orchestration sign-off

**Batch:** C · **Depends on:** T3, T4 · **Parallel with:** — (terminal task)

**Description:** The final definition-of-done gate. Wire the concurrent dev flow, run every tool against the as-merged skeleton, fix any scaffold gaps, and record proof. This task **may edit** root `package.json` (confirm scripts) and any T3/T4 file where a gap surfaced — rebase onto a `main` containing T1–T4 first.

Steps:
1. `cp frontend/.env.example frontend/.env` and `cp backend/.env.example backend/.env` locally (verify `.env` stays ignored).
2. `npm install` at root (resolves both workspaces).
3. `npm run dev` — confirm both `api` and `web` logs stream; frontend at `:5173` shows "API: ok".
4. `curl http://localhost:3000/api/health` → expect `{ "status": "ok", ... }`.
5. Run, in order, on a **clean working tree (no uncommitted changes)**:
   - `npm run lint`
   - `npm run format:check`
   - `npm run typecheck`
   - `npm run test`
6. Confirm `.env.example` files are tracked and `.env`/`dist`/`node_modules` are **not** (`git status --ignored`).
7. Document any deviations in this file's §7 record (below) or open follow-ups.

**Acceptance Criteria:**
- [ ] `npm run dev` boots both apps concurrently; health probe green from the browser.
- [ ] `npm run lint` exits 0 on an empty change.
- [ ] `npm run format:check` exits 0 on an empty change.
- [ ] `npm run typecheck` exits 0 across both packages.
- [ ] `npm run test` exits 0 (frontend smoke + backend health tests).
- [ ] `.env.example` tracked for both packages; `.env`, `dist/`, `node_modules/` ignored.
- [ ] All four F01 acceptance bullets (§1) satisfied; record commit SHAs.

**Dependencies:** T3, T4.

---

## 7. Final F01 Acceptance Checklist

- [ ] `frontend/` and `backend/` match the directory structure in `js-development-rules.md`.
- [ ] Root scripts start both apps concurrently in dev (`npm run dev`).
- [ ] `.env.example` committed for both packages; real `.env` gitignored.
- [ ] `npm run lint` + `npm run format:check` pass on an empty change.
- [ ] (Bonus, wired now to prevent retrofit) `npm run typecheck` + `npm run test` pass.

**Integration record (fill during T5):**
- Root dev SHA: `________`
- `/api/health` response: `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`
