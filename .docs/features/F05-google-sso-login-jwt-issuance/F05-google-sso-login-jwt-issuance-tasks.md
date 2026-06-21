# F05 — Google SSO Login + JWT Issuance: Plan + Task Breakdown

> **Feature:** F05 — Google SSO login + JWT issuance (Phase 1 — Identity & Access)
> **Feature index:** [`.docs/features.md`](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F02, F03, F04 · **PRD ref:** REQ-1.1, §5, §8.1
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), `.claude/rules/{js-development-rules,js-style-guide,js-testing-rules,git-guidelines,persona}.md`, plus dependency task docs: [F02](../F02-database-migration-pipeline/F02-database-migration-pipeline-tasks.md), [F03](../F03-api-contract-layer/F03-api-contract-layer-tasks.md), [F04](../F04-frontend-app-shell/F04-frontend-app-shell-tasks.md)

---

## 1. F05 Recap

**Goal:** Users sign in with Google; the backend issues a session.

**Ships:** "Sign in with Google" button → GIS popup auth-code flow → backend exchanges code + verifies ID token → user upserted into `Users` → JWT returned → frontend persists token + user in `useAuthStore` (Zustand `persist`) → authenticated SPA state survives reload.

**Acceptance (definition of done):**

1. Google OAuth 2.0 flow (Authorization Code, PKCE) completes end to end.
2. `google_id`, `email`, `full_name`, `avatar_url` populated on first login; updated on subsequent logins.
3. JWT signed with `JWT_SECRET`, contains `sub`, `email`, `role`, `exp` claim.
4. Logout clears the token client-side.

(All four bullets copied verbatim from `features.md:157-160`; tightened with the observable wiring each implies.)

**Spec reconciliation note** (include at sign-off): Spec says "OAuth redirect → backend exchanges code" and "(Authorization Code, PKCE)". Owner-selected GIS popup flow IS Authorization Code with PKCE — `@react-oauth/google` `flow: 'auth-code'` generates and handles the PKCE challenge internally under the hood, and the backend still presents `client_secret` at Google's token endpoint (Google enforces this for Web Application client type per OAuth 2.1). The "redirect" is the `postMessage` from the GIS popup back to the opener window, not a server-side 302. Both are spec-compliant.

**Edge cases — resolved up front:**

- **Token storage (HttpOnly cookie vs in-memory + refresh)** → **Decision: localStorage JWT via Zustand `persist`** (D2). Rationale: matches existing `apiFetch` Bearer pattern at `frontend/src/api/client.ts:30-37` + `js-development-rules.md:42-57` persona example + zero DB schema delta. **Accepted XSS tradeoff — F07 hardens** (token revocation, refresh, multi-tab logout sync).
- **Clock skew between Google and server rejecting `iat`** → **Decision: `jose` `clockTolerance: '30s'` on our own JWT verify (D4); `google-auth-library` `verifyIdToken` default leeway is acceptable since Google's `iat` is the authoritative value.**
- **Account with no avatar/name** → **Decision: backend stores `null` `avatarUrl` (schema already nullable at `backend/src/db/schema.ts:13`); frontend `TopNav` derives initials from `fullName` (or `email` local-part) per D15.**

---

## 2. Codebase Analysis Summary

- **State:** **Phase 0 (Foundation) complete.** F01–F04 merged and verified (SHA `86787b2`, 2026-06-22). Backend boots with Express 5 + Helmet + CORS + pino + Zod 4 envelope contract; frontend boots with React 19 + Vite 7 + Tailwind 4 + TanStack Query 5 + Zustand 5 + react-router 7 (data-router). `LoginPage.tsx:8-15` is a demo placeholder (F05 rewrites); `RequireAuth.tsx:4-12` does a null-check on `user` (F05 hardens w/ JWT `exp` decode); `useAuthStore` has no `persist` middleware yet.
- **Backend runtime + middleware order (`backend/src/index.ts:14-50`):** `helmet()` → `cors({origin: env.frontendUrl, credentials: true, allowedHeaders: ['Content-Type','Authorization']})` → `requestLogger` (pino-http, redacts `authorization`/`cookie`/`*.token` per `backend/src/config/logger.ts:8-15`) → `express.json()` → `GET /api/health` (non-enveloped) → `app.use('/api', pingRouter)` (`:46`) → `notFound` (`:49`) → `errorHandler` (`:50`). **F05 mounts `app.use('/api/auth', authRouter)` between `:46` and `:49`.** CORS already permits `Authorization` header + `credentials:true` — no F05 CORS change.
- **Backend deps (`backend/package.json:19-29`):** runtime has `express ^5`, `drizzle-orm ^0.45`, `pg ^8.22`, `zod ^4.4.3`, `helmet ^8`, `cors ^2.8.5`, `pino ^10`, `pino-http ^11`, `dotenv ^17`. Dev has `supertest ^7`, `tsx ^4`, `drizzle-kit`, `vitest ^3`. **Missing (F05 installs in T1):** `jose`, `google-auth-library`.
- **Backend empty dirs awaiting F05:** `backend/src/{routes,services}` — `.gitkeep`-only.
- **F02 DB layer:** `backend/src/db/client.ts:1-25` exports `db` (drizzle-node-postgres) + `pool` (pg.Pool, lazy singleton on `globalThis.__slykPool`, `max: 5`). Schema at `backend/src/db/schema.ts:8-22`: `users` table has `id uuid PK`, `googleId text unique notNull`, `email text unique notNull`, `fullName text notNull`, `avatarUrl text` (nullable), `role Role default 'MEMBER' notNull`, `createdAt`, `updatedAt` (with `$onUpdate(() => new Date())`). **No F05 schema delta needed.** Seed at `backend/src/db/seed.ts:9-29` uses `.onConflictDoNothing({target: users.email})` — F05's upsert uses `.onConflictDoUpdate({target: users.googleId})` (D9).
- **F03 API contract:** Envelope `success(data) => {data}` (`backend/src/utils/envelope.ts:28`), `error(code, msg, details?)` (`:34-48`). Closed error codes (`:5-12`): `VALIDATION_FAILED 400`, `UNAUTHENTICATED 401`, `FORBIDDEN 403`, `NOT_FOUND 404`, `CONFLICT 409`, `INTERNAL_ERROR 500`. `AppError(code, msg, {details?, cause?})` (`backend/src/utils/appError.ts:18-33`) auto-derives `status` from `codeToStatus[code] ?? 500`. `validateRequest({body?, query?, params?})` (`backend/src/middleware/validateRequest.ts:33-66`) uses Zod 4 `z.flattenError`. Per-route schema co-location pattern: `routes/<feature>.schema.ts`.
- **F04 frontend seams F05 integrates with:**
  - `apiFetch<T>(path, init?)` at `frontend/src/api/client.ts:26-76` already auto-injects `Authorization: Bearer <token>` from `useAuthStore.getState().user?.token` (`:30-37`). **No F05 change to `client.ts`** — works as-is once the store carries a JWT.
  - `useAuthStore` at `frontend/src/stores/useAuthStore.ts:1-19`: `AuthUser {token, email, name}`, no `persist` (F05 adds via T8). `setUser`/`clear` already exported.
  - `RequireAuth.tsx:4-12` reads `useAuthStore(s => s.user)`, redirects to `/login` w/ `state={{from: location}}` when null. F05 hardens (T9) with JWT `exp` decode + auto-clear on expiry.
  - `LoginPage.tsx:8-15` is a demo placeholder. F05 rewrites (T10) with `useGoogleLogin({flow: 'auth-code'})`.
  - `LoginPage.test.tsx:33-45` asserts the demo flow. F05 updates (T10).
  - Provider stack at `frontend/src/main.tsx:15-22`: `StrictMode > ErrorBoundary > QueryClientProvider > RouterProvider`. F05 inserts `<GoogleOAuthProvider>` (T7).
  - Path alias `@/` confirmed in `frontend/vite.config.ts:9-11` + `frontend/tsconfig.json:10-12`.
  - Tailwind tokens at `frontend/src/index.css:1-29`: `--color-{background,foreground,primary,muted,border}`. No `--color-danger` yet.
- **Env gaps F05 fills:**
  - Backend `.env.example:1-5` has `PORT`, `FRONTEND_URL`, `DATABASE_URL`, `TZ`. **Missing:** `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `ALLOWED_DOMAIN` (last one deferred to F06 but documented now).
  - Frontend `.env.example:1-3` has only `VITE_API_BASE_URL` (with a comment "Future vars (VITE_GOOGLE_CLIENT_ID etc.) added by F05+"). **Missing:** `VITE_GOOGLE_CLIENT_ID`.
  - `backend/src/config/env.ts:11-16` validates only `FRONTEND_URL` + `DATABASE_URL`. F05 adds 4 new keys (T1).
  - `backend/vitest.config.ts:1-13` injects `FRONTEND_URL`, `NODE_ENV=test`, `DATABASE_URL`. F05 extends with 4 new test-env keys (T1).
  - `frontend/src/config/env.ts:1-13` reads only `VITE_API_BASE_URL`. F05 adds `googleClientId` (T7).
  - `frontend/src/vite-env.d.ts:1-9` declares only `VITE_API_BASE_URL`. F05 augments with `VITE_GOOGLE_CLIENT_ID` (T7).
- **Project rules this plan must satisfy:** `js-development-rules.md` (frontend + backend conventions, API client pattern, env table, deployment targets), `js-style-guide.md` (PascalCase components, camelCase hooks, SCREAMING_SNAKE_CASE constants, 4-space JSX / 2-space TS, `import type`, `any` banned, no inline styles, no prop drilling, no magic numbers), `js-testing-rules.md` (Vitest, co-located `*.test.tsx`, Testing Library priority `getByRole > getByLabelText > getByText > getByTestId`, coverage targets >80% business / >70% components), `git-guidelines.md` (branch `feature/SLYK-F05-...`, single-line commits `SLYK-F05: msg`, rebase-and-merge only, no squash, `.gitignore` intact), `persona.md` (React 19 + Express 5 + Postgres + `@react-oauth/google` + `google-auth-library` + Vercel + Render).
- **Prior art / partial work:** None for real auth. F04's placeholder `LoginPage.tsx` + `RequireAuth.tsx` are the structural skeleton F05 swaps real logic into. `apiFetch` Bearer header injection is already wired — no change.
- **File paths the plan references that do NOT exist yet (will be created):**
  - Backend: `backend/src/utils/jwt.ts`, `backend/src/utils/jwt.test.ts`, `backend/src/config/googleClient.ts`, `backend/src/services/googleOAuth.ts`, `backend/src/services/googleOAuth.test.ts`, `backend/src/services/userService.ts`, `backend/src/services/userService.test.ts`, `backend/src/middleware/auth.ts`, `backend/src/middleware/auth.test.ts`, `backend/src/types/express.d.ts`, `backend/src/routes/auth.routes.ts`, `backend/src/routes/auth.schema.ts`, `backend/src/routes/auth.routes.test.ts`.
  - Frontend: `frontend/src/api/auth.ts`, `frontend/src/api/auth.test.ts`.
- **Hidden coupling to plan for:**
  - **`app.use('/api/auth', authRouter)` must mount BEFORE `app.use(notFound)`** (`backend/src/index.ts:46-49`) — otherwise `/api/auth/*` returns 404.
  - **`@react-oauth/google` provider must be INSIDE `StrictMode` but OUTSIDE `ErrorBoundary`** — a GIS popup init failure should not crash the whole app boundary. Document this in T7.
  - **`GOOGLE_CALLBACK_URL=postmessage`** is Google's literal sentinel string for the GIS popup auth-code flow (D6) — NOT a real URL. Document this in T1 and T13 or the next developer will try to "fix" it.
  - **Zustand `persist` rehydrates synchronously from `localStorage`** — `useAuthStore.getState().user` is non-null on first render if a JWT was stored. This means `RequireAuth`'s check passes immediately on reload (good UX); T9's `exp` decode adds the expiry guard on top.
  - **`apiFetch` reads the token from `useAuthStore.getState().user?.token`** — not from a cookie. D2's storage choice is locked in by this existing seam; switching to HttpOnly cookies later (F07) requires rewriting `apiFetch` + adding a `/api/auth/me` refresh dance. Document the tradeoff.
  - **`jose` v6 `decodeJwt` does NOT verify** — it's only for the client-side `exp` hint (D14). The backend `verifyJwt` (T2) is the security boundary; the frontend hint is UX-only.
  - **`google-auth-library` `OAuth2Client` is a singleton** — T3 creates ONE instance at `backend/src/config/googleClient.ts`; tests mock the module. Do NOT instantiate per-request (TLS handshake cost + memory leak).
  - **`verbatimModuleSyntax` applies to both workspaces** — all type-only imports (`import type { JwtPayload }`, `import type { Request, Response, NextFunction }`) must use `import type`.
  - **Zod v4 API:** `z.flattenError(result.error)` (not `.format()`) — F03 already uses this; F05's `auth.schema.ts` follows the same pattern.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | **OAuth flow** | **Client-side GIS popup via `@react-oauth/google` v0.13.x `flow: 'auth-code'`** | Owner sign-off + `persona.md` library pick. Frontend pops consent, receives one-time `code`, POSTs `{code}` to backend. Avoids server-side redirect dance; simplest UX for SPA. |
| D2 | **Token storage** | **JWT in `localStorage` via Zustand `persist` middleware** (`name: 'slyk-auth'`, `partialize: (s) => ({user: s.user})`) | Existing `apiFetch` already injects `Authorization: Bearer <token>` from store (`frontend/src/api/client.ts:30-37`). Matches `js-development-rules.md:42-57` persona pattern + zero DB schema change. **Accepted XSS tradeoff — F07 will harden.** |
| D3 | **JWT lib** | **`jose` v6.x** with HS256 symmetric key from `JWT_SECRET` via `createSecretKey(Buffer.from(JWT_SECRET))` | Avoids `jsonwebtoken` algorithm-confusion CVEs (CVE-2024-54150). npm/jose. |
| D4 | **JWT claims + TTL** | **`sub` (user.id uuid), `email`, `role`, `iat`, `exp`, `iss: 'slykboard'`, `aud: 'slykboard-web'`. TTL 8h.** Verify options: `{ issuer, audience, clockTolerance: '30s' }` | Workday TTL. `clockTolerance` handles clock skew edge case (F05 spec). |
| D5 | **Google ID token verification** | **`google-auth-library` v10.x `OAuth2Client.verifyIdToken({idToken, audience: GOOGLE_CLIENT_ID})`** | Checks signature + `aud` + `iss` (`accounts.google.com` or `https://accounts.google.com`) + `exp` in one call. googleapis/google-auth-library-nodejs. |
| D6 | **GIS popup redirect URI** | **`GOOGLE_CALLBACK_URL=postmessage`** | Google's literal sentinel string for GIS popup auth-code flow. NOT a real URL. Document in T13. |
| D7 | **Error codes** | **Reuse F03 closed vocabulary** (`UNAUTHENTICATED 401` bad JWT, `VALIDATION_FAILED 400` bad code body, `INTERNAL_ERROR 500` Google exchange/verify failures) | No new codes without owner sign-off. Google failure messages redacted to generic `"Authentication failed"` to avoid leaking upstream errors. |
| D8 | **Default role** | **`'MEMBER'`** (schema default) | First-user `ADMIN` promotion is F06. |
| D9 | **Upsert semantics** | **`db.insert(users).values({...}).onConflictDoUpdate({target: users.googleId, set: {email, fullName, avatarUrl, updatedAt: new Date()}})`** | Refresh email/name/avatar every login. |
| D10 | **Logout** | **Stateless JWT → backend `POST /api/auth/logout` is a no-op** returning `{data: {success: true}}`; frontend `useAuthStore.clear()` is authoritative | No token denylist (deferred to F07). |
| D11 | **Post-login redirect** | **Hardcoded `/`** | Never trust client-supplied URLs — open-redirect CVE mitigation. |
| D12 | **`authenticate` middleware** | **Reads `Authorization: Bearer <jwt>` (case-insensitive scheme), `verifyJwt`, attaches `req.user = {id, email, role}`** | Throws `AppError('UNAUTHENTICATED', 'Missing or invalid token')` on missing/invalid. |
| D13 | **Env fail-fast** | **`backend/src/config/env.ts` validates all 5 new keys at boot; throws on missing** | Secrets never defaulted in production. |
| D14 | **Client-side expiry hint** | **`RequireAuth` decodes JWT `exp` via `jose` `decodeJwt`** | On expiry, `clear()` + redirect `/login`. Backend is source of truth (security); frontend hint is UX only. `decodeJwt` does NOT verify — just reads the claim. |
| D15 | **Initials fallback** | **When Google omits `avatarUrl`, frontend derives initials from `fullName` (or `email` local-part)** for TopNav avatar slot | Backend stores `null` (schema already nullable). |

> **Out of F05 scope (explicitly deferred):**
> - `ALLOWED_DOMAIN` enforcement, email whitelist, first-user `ADMIN` promotion → **F06** (Onboarding, workspace restriction & roles).
> - Token revocation, refresh tokens, role-change session invalidation, multi-tab logout sync → **F07** (Session lifecycle & auth guards).
> - Role guards (`requireRole('ADMIN')`) → **F07 / F17 / F25**.
> - Google token revocation endpoint on logout → **F07**.
> - HttpOnly cookie migration → **F07** (would require rewriting `apiFetch` + refresh-token endpoint).

> **Owner sign-off needed:** All 15 decisions above were owner-resolved during planning (2026-06-22) and are binding. No outstanding questions.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                              # repo root
├── backend/
│   ├── package.json                                    # MODIFY — add jose + google-auth-library
│   ├── .env.example                                    # MODIFY — add 5 new keys (JWT_SECRET, GOOGLE_CLIENT_*, GOOGLE_CALLBACK_URL=postmessage, ALLOWED_DOMAIN=)
│   ├── vitest.config.ts                                # MODIFY — extend test env with 4 new keys
│   └── src/
│       ├── config/
│       │   ├── env.ts                                  # MODIFY — add jwtSecret, googleClientId, googleClientSecret, googleCallbackUrl, allowedDomain? + fail-fast
│       │   └── googleClient.ts                         # NEW (T3) — singleton OAuth2Client
│       ├── index.ts                                    # MODIFY (T6) — mount app.use('/api/auth', authRouter) between :46 and :49
│       ├── types/
│       │   └── express.d.ts                            # NEW (T5) — augment Request with user?: {id, email, role}
│       ├── utils/
│       │   ├── jwt.ts                                  # NEW (T2) — signJwt + verifyJwt (jose HS256)
│       │   └── jwt.test.ts                             # NEW (T2) — table-driven sign/verify/exp/reject
│       ├── services/
│       │   ├── googleOAuth.ts                          # NEW (T3) — exchangeCodeForUser(code) → {googleId, email, fullName, avatarUrl}
│       │   ├── googleOAuth.test.ts                     # NEW (T3) — mock OAuth2Client
│       │   ├── userService.ts                          # NEW (T4) — upsertByGoogleId()
│       │   └── userService.test.ts                     # NEW (T4) — mock db
│       ├── middleware/
│       │   ├── auth.ts                                 # NEW (T5) — authenticate (Bearer → verifyJwt → req.user)
│       │   └── auth.test.ts                            # NEW (T5) — table-driven valid/missing/malformed/expired/wrong-iss/wrong-aud
│       └── routes/
│           ├── auth.routes.ts                          # NEW (T6) — POST /google, GET /me, POST /logout
│           ├── auth.schema.ts                          # NEW (T6) — Zod 4 {code: z.string().min(1)}
│           └── auth.routes.test.ts                     # NEW (T6) — supertest + vi.mock
└── frontend/
    ├── package.json                                    # MODIFY (T7 or T9) — add @react-oauth/google + jose
    ├── .env.example                                    # MODIFY (T7) — add VITE_GOOGLE_CLIENT_ID
    └── src/
        ├── vite-env.d.ts                               # MODIFY (T7) — augment ImportMetaEnv with VITE_GOOGLE_CLIENT_ID
        ├── config/
        │   └── env.ts                                  # MODIFY (T7) — add googleClientId to EnvConfig
        ├── main.tsx                                    # MODIFY (T7) — wrap with <GoogleOAuthProvider> inside StrictMode, outside ErrorBoundary
        ├── stores/
        │   ├── useAuthStore.ts                         # MODIFY (T8) — extend AuthUser + add persist middleware
        │   └── useAuthStore.test.ts                    # MODIFY (T8) — new shape + persist
        ├── components/
        │   ├── RequireAuth.tsx                         # MODIFY (T9) — decodeJwt exp → clear + redirect
        │   ├── RequireAuth.test.tsx                    # MODIFY (T9)
        │   ├── TopNav.tsx                              # MODIFY (T12) — avatar img + initials fallback + Sign out button
        │   └── TopNav.test.tsx                         # MODIFY (T12)
        ├── pages/
        │   ├── LoginPage.tsx                           # MODIFY (T10) — useGoogleLogin rewrite
        │   └── LoginPage.test.tsx                      # MODIFY (T10)
        └── api/
            ├── auth.ts                                 # NEW (T11) — loginWithGoogle, fetchMe, logout
            └── auth.test.ts                            # NEW (T11)
```

**Request lifecycle (login flow — non-obvious):**

1. User clicks "Sign in with Google" in `LoginPage` (T10).
2. `useGoogleLogin({flow: 'auth-code', onSuccess: async ({code}) => {...}})` pops the GIS consent window. User consents. GIS `postMessage`s the one-time `code` back to the opener.
3. Frontend calls `loginWithGoogle(code)` (T11) → `apiFetch('/auth/google', {method: 'POST', body: JSON.stringify({code})})`.
4. `apiFetch` prepends `env.apiBaseUrl` (`http://localhost:3000/api`), sets `Accept`/`Content-Type`, calls `fetch`. (No `Authorization` header yet — user is unauthenticated.)
5. Backend route `POST /api/auth/google` (`auth.routes.ts`) → `validateRequest(authCodeSchema)` (Zod 4 `{code: z.string().min(1)}`) → `googleOAuth.exchangeCodeForUser(code)` (T3: `OAuth2Client.getToken(code)` + `verifyIdToken({idToken, audience})` → normalize `{googleId, email, fullName, avatarUrl}`) → `userService.upsertByGoogleId(...)` (T4: Drizzle `onConflictDoUpdate` on `googleId`) → `jwt.signJwt({sub: user.id, email, role})` (T2) → `res.json(success({token, user}))`.
6. Frontend `apiFetch` unwraps `{data: {token, user}}` → `loginWithGoogle` returns it.
7. `LoginPage.onSuccess` calls `useAuthStore.getState().setUser({token, id, email, name, role, avatarUrl})` → `persist` writes `{user}` to `localStorage['slyk-auth']`.
8. `LoginPage` calls `navigate(from ?? '/', {replace: true})` (D11 — hardcoded `/`, never client-supplied).
9. Router re-evaluates → `RequireAuth` reads `user` (non-null), decodes `exp` (T9 — still valid), renders `<Outlet/>` → `<AppLayout/>` → board placeholder.

**Subsequent API calls:** `apiFetch` reads `useAuthStore.getState().user?.token` (`:30-37`), injects `Authorization: Bearer <jwt>`. Backend `authenticate` middleware (T5) verifies, attaches `req.user`. On 401, frontend (F07) will global-intercept — F05 only logs the ApiClientError.

**Logout:** User clicks "Sign out" in `TopNav` (T12) → `logout()` (T11, best-effort POST `/auth/logout`, swallows errors) → `useAuthStore.clear()` (clears `localStorage['slyk-auth']`) → `navigate('/login', {replace: true})`. Backend `POST /api/auth/logout` is a no-op `{data: {success: true}}` (D10).

---

## 5. Parallelization Strategy

Tasks are grouped into **5 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
                  ┌──────────────────────────────────────────────────────┐
   Batch A        │ T1  backend env + deps (jose, google-auth-library,    │
   (foundation:   │     env.ts, .env.example, vitest.config.ts)          │
    install +     │ T7  frontend env + GoogleOAuthProvider                │
    config)       │ T8  frontend auth store hardening (persist)           │
                  │     (all three disjoint: backend vs frontend-env vs   │
                  │      frontend-store)                                  │
                  └──────────────┬───────────────────────────────────────┘
                                 │ (deps installed, env vars exist)
                                 ▼
                  ┌──────────────────────────────────────────────────────┐
   Batch B        │ T2  backend jwt.ts (signJwt + verifyJwt)              │
   (backend core: │ T3  backend googleOAuth.ts + googleClient.ts          │
    parallel)     │ T4  backend userService.ts (upsert)                   │
                  │     (all three after T1; disjoint files)              │
                  └──────────────┬───────────────────────────────────────┘
                                 │ (jwt + google + upsert exist)
                                 ▼
                  ┌──────────────────────────────────────────────────────┐
   Batch C        │ T5  backend authenticate middleware + express.d.ts    │
   (backend       │     (after T2; parallel with T6-prep)                 │
    wiring)       │ T6  backend auth.routes.ts + mount in index.ts        │
                  │     (after T2, T3, T4, T5; terminal backend)          │
                  └──────────────┬───────────────────────────────────────┘
                                 │ (backend complete; /api/auth/* live)
                                 ▼
                  ┌──────────────────────────────────────────────────────┐
   Batch D        │ T9  frontend RequireAuth harden (decodeJwt exp)       │
   (frontend core:│ T10 frontend LoginPage rewrite (useGoogleLogin)       │
    parallel)     │ T11 frontend api/auth.ts wrappers                      │
                  │ T12 frontend TopNav logout + avatar                   │
                  │     (all after T8; T10/T12 stub @/api/auth until T11) │
                  └──────────────┬───────────────────────────────────────┘
                                 │ (frontend complete)
                                 ▼
                  ┌──────────────────────────────────────────────────────┐
   Batch E        │ T13 end-to-end smoke + Google Cloud Console docs      │
   (integration + │     (after T6, T9, T10, T11, T12)                     │
    verification) │ T14 integration verification & sign-off (terminal)    │
                  └──────────────────────────────────────────────────────┘
```

- **Batch A → Batch B** is a hard barrier: T2/T3/T4 import `env.jwtSecret`/`env.googleClientId`/`env.googleClientSecret` which don't exist until T1 lands. T2 imports `jose`, T3 imports `google-auth-library` — both T1 installs.
- **Batch B → Batch C** is a hard barrier: T5's `authenticate` calls `verifyJwt` (T2); T6's `/auth/google` route calls `exchangeCodeForUser` (T3) + `upsertByGoogleId` (T4) + `signJwt` (T2) + `authenticate` (T5).
- **Batch C → Batch D** is NOT a hard barrier — T9/T10/T11/T12 are frontend-only and can branch as soon as T7 + T8 (Batch A) merge. They don't need the backend to compile. **However, T13 (smoke) needs both.**
- **Batch D → Batch E** is a hard barrier: T13 exercises the full stack (frontend → backend → Google → DB).

**Within Batch B, T2 / T3 / T4 touch disjoint files** (confirmed by file-set inspection):
- **T2** owns: `backend/src/utils/jwt.ts`, `backend/src/utils/jwt.test.ts`.
- **T3** owns: `backend/src/config/googleClient.ts`, `backend/src/services/googleOAuth.ts`, `backend/src/services/googleOAuth.test.ts`.
- **T4** owns: `backend/src/services/userService.ts`, `backend/src/services/userService.test.ts`.

No overlaps. All three can branch off `main` post-T1, implement, and merge in any order.

**Within Batch D, T9 / T10 / T11 / T12 touch disjoint files:**
- **T9** owns: `frontend/src/components/RequireAuth.tsx`, `frontend/src/components/RequireAuth.test.tsx`.
- **T10** owns: `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/LoginPage.test.tsx`.
- **T11** owns: `frontend/src/api/auth.ts`, `frontend/src/api/auth.test.ts`.
- **T12** owns: `frontend/src/components/TopNav.tsx`, `frontend/src/components/TopNav.test.tsx`.

T10 and T12 both import from `@/api/auth` (T11). During parallel dev, they stub `loginWithGoogle`/`logout` locally and swap to the real import at integration. Merge T11 first if possible.

### Merge order rules

1. **Batch A (T1, T7, T8) merges first, in any order (parallel-safe).** Disjoint file sets (backend vs frontend-env vs frontend-store). All three must be on `main` before Batch B branches.
2. **Batch B (T2, T3, T4) merges second, in any order (parallel-safe).** Disjoint file sets. Each imports from T1 outputs (already on `main`).
3. **Batch C (T5, then T6) merges third, sequentially.** T5 creates `middleware/auth.ts` + `types/express.d.ts`; T6 consumes them. T6 also needs T2/T3/T4 (already merged). Recommended: T5 → T6 in the same PR if a single developer owns both.
4. **Batch D (T9, T10, T11, T12) merges fourth, in any order (parallel-safe).** Disjoint file sets. All import from T7/T8 outputs. T11 ideally merges before T10/T12 to avoid stub-swap churn.
5. **Batch E (T13, then T14) merges last, sequentially.** T13 is the end-to-end smoke against a live backend + Google Cloud Console; T14 is the terminal verification gate (lint/format/typecheck/test/build all green).

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `backend/package.json`, `backend/.env.example`, `backend/src/config/env.ts`, `backend/vitest.config.ts` | — | T7, T8 |
| **T2** | B | `backend/src/utils/jwt.ts`, `backend/src/utils/jwt.test.ts` | T1 | T3, T4 |
| **T3** | B | `backend/src/config/googleClient.ts`, `backend/src/services/googleOAuth.ts`, `backend/src/services/googleOAuth.test.ts` | T1 | T2, T4 |
| **T4** | B | `backend/src/services/userService.ts`, `backend/src/services/userService.test.ts` | T1 | T2, T3 |
| **T5** | C | `backend/src/middleware/auth.ts`, `backend/src/types/express.d.ts`, `backend/src/middleware/auth.test.ts` | T2 | T6 (prep only) |
| **T6** | C | `backend/src/routes/auth.routes.ts`, `backend/src/routes/auth.schema.ts`, `backend/src/routes/auth.routes.test.ts`, `backend/src/index.ts` | T2, T3, T4, T5 | — |
| **T7** | A | `frontend/package.json`, `frontend/.env.example`, `frontend/src/config/env.ts`, `frontend/src/vite-env.d.ts`, `frontend/src/main.tsx` | — | T1, T8 |
| **T8** | A | `frontend/src/stores/useAuthStore.ts`, `frontend/src/stores/useAuthStore.test.ts` | — | T1, T7 |
| **T9** | D | `frontend/src/components/RequireAuth.tsx`, `frontend/src/components/RequireAuth.test.tsx`, `frontend/package.json` (jose) | T8 | T10, T11, T12 |
| **T10** | D | `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/LoginPage.test.tsx` | T7, T8 | T9, T11, T12 |
| **T11** | D | `frontend/src/api/auth.ts`, `frontend/src/api/auth.test.ts` | T8 | T9, T10, T12 |
| **T12** | D | `frontend/src/components/TopNav.tsx`, `frontend/src/components/TopNav.test.tsx` | T8, T11 | T9, T10 |
| **T13** | E | (docs + manual smoke; updates root `README.md` if it references env) | T6, T9, T10, T11, T12 | — |
| **T14** | E | (terminal verification; fills §7 integration record) | T13 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → (T2 ‖ T3 ‖ T4) → T5 → T6 → (T7 ‖ T8) → (T9 ‖ T10 ‖ T11 ‖ T12) → T13 → T14. ~2-3 days.
- **2 devs:**
  - **Dev-A (backend):** T1 → (T2 ‖ T3 ‖ T4) → T5 → T6 → T13 (backend half) → T14.
  - **Dev-B (frontend):** (T7 ‖ T8, after Dev-A's T1 if env.ts pattern is referenced) → (T9 ‖ T10 ‖ T11 ‖ T12) → T13 (frontend half) → T14.
  - Merge order: Batch A backend (T1) → Batch A frontend (T7, T8) ‖ Batch B (T2/T3/T4) → Batch C (T5/T6) ‖ Batch D (T9-T12) → Batch E (T13/T14).
- **3 devs:**
  - **Dev-A (backend infra):** T1 → T2 → T5 → T6.
  - **Dev-B (backend integration):** T3 → T4 (after T1) → help T6.
  - **Dev-C (frontend):** T7 → T8 (parallel with T1) → (T9 ‖ T10 ‖ T11 ‖ T12) → T13 → T14.
  - Merge coordination: Dev-A owns the `index.ts` mount commit (T6); Dev-C owns the `main.tsx` provider commit (T7).

---

## 6. Tasks

### T1 — Backend env + deps (jose, google-auth-library, env.ts fail-fast)

**Batch:** A · **Depends on:** None · **Parallel with:** T7, T8

**Description:** Install the two backend runtime deps F05 introduces (`jose` for JWT, `google-auth-library` for Google ID token verification). Extend `backend/src/config/env.ts` (the single reader of `process.env`, mirroring frontend's `config/env.ts` pattern from F04 D5) with the 5 new keys F05 needs. Update `.env.example` and `vitest.config.ts` test env so the next developer can boot and test without guessing.

Create / Modify:

- **`backend/package.json`** (MODIFY). Install from repo root:

  ```bash
  npm install -w backend jose google-auth-library
  ```

  Runtime pins: `jose ^6` (HS256 + algorithm-confusion-safe per D3), `google-auth-library ^10` (`verifyIdToken` per D5). Both are ESM-compatible with the backend's `"type": "module"`.

- **`backend/src/config/env.ts`** (MODIFY). Extend `Config` + `loadConfig` with 5 new keys. Follow the existing fail-fast pattern at `:11-16`.

  ```typescript
  export interface Config {
    port: number;
    frontendUrl: string;
    nodeEnv: string;
    databaseUrl: string;
    jwtSecret: string;           // F05 D3 — HS256 signing key
    googleClientId: string;      // F05 D5 — OAuth client ID (audience check)
    googleClientSecret: string;  // F05 D1 — server-side token exchange
    googleCallbackUrl: string;   // F05 D6 — 'postmessage' sentinel for GIS popup
    allowedDomain?: string;      // F06 — empty/undefined = allow all (F05 ships undefined)
  }

  export function loadConfig(envSource: NodeJS.ProcessEnv = process.env): Config {
    // ...existing FRONTEND_URL + DATABASE_URL checks...
    if (!envSource.JWT_SECRET) throw new Error('Missing JWT_SECRET');
    if (!envSource.GOOGLE_CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID');
    if (!envSource.GOOGLE_CLIENT_SECRET) throw new Error('Missing GOOGLE_CLIENT_SECRET');
    if (!envSource.GOOGLE_CALLBACK_URL) throw new Error('Missing GOOGLE_CALLBACK_URL');
    return {
      // ...existing keys...
      jwtSecret: envSource.JWT_SECRET,
      googleClientId: envSource.GOOGLE_CLIENT_ID,
      googleClientSecret: envSource.GOOGLE_CLIENT_SECRET,
      googleCallbackUrl: envSource.GOOGLE_CALLBACK_URL,
      allowedDomain: envSource.ALLOWED_DOMAIN || undefined,
    };
  }
  ```

  Notes: (a) `ALLOWED_DOMAIN` is optional in F05 (enforcement is F06) but the key is declared now so F06 doesn't need a second env.ts edit. (b) `JWT_SECRET` minimum length should be validated — HS256 needs ≥32 bytes; add a runtime check `if (envSource.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be >= 32 chars')`.

- **`backend/.env.example`** (MODIFY). Add 5 new keys with comments. **Document `GOOGLE_CALLBACK_URL=postmessage` explicitly** (D6 — it's Google's sentinel, not a URL).

  ```
  PORT=3000
  FRONTEND_URL=http://localhost:5173
  DATABASE_URL=postgresql://slyk:slyk@localhost:5432/slykboard
  TZ=UTC

  # F05 — Google SSO + JWT
  # Generate with: openssl rand -base64 48 (min 32 chars for HS256)
  JWT_SECRET=replace-me-with-a-32-plus-char-random-string
  GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET=your-client-secret
  # D6: 'postmessage' is Google's literal sentinel for the GIS popup auth-code flow.
  # NOT a real URL. Do NOT change to http://localhost:... — the GIS library handles redirect internally.
  GOOGLE_CALLBACK_URL=postmessage
  # F06: leave empty to allow all Google accounts; set to your G-Suite domain to restrict.
  ALLOWED_DOMAIN=
  ```

- **`backend/vitest.config.ts`** (MODIFY). Extend the test env so tests don't fail on the new required keys. Keep test values inert.

  ```typescript
  env: {
    FRONTEND_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    // F05 test env (inert values — tests mock jose/google-auth-library)
    JWT_SECRET: 'test-secret-at-least-32-characters-long-aaaa',
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_CALLBACK_URL: 'postmessage',
  },
  ```

  Notes: The existing test-env `DATABASE_URL` points at a non-existent Postgres; F02's `db.test.ts` failures are pre-existing and NOT F05 regressions (documented in F04 §7). The new keys are all strings, so they don't require a running DB.

**Acceptance Criteria:**
- [ ] `npm install` succeeds from repo root; `backend/package.json` lists `jose ^6` + `google-auth-library ^10` in `dependencies`.
- [ ] `backend/src/config/env.ts` exports `Config` with `jwtSecret`, `googleClientId`, `googleClientSecret`, `googleCallbackUrl`, `allowedDomain?`; `loadConfig` throws on any of the 4 required keys missing + on `JWT_SECRET` < 32 chars.
- [ ] `backend/.env.example` has all 5 new keys with comments; `GOOGLE_CALLBACK_URL=postmessage` documented as Google's sentinel.
- [ ] `backend/vitest.config.ts` test env has all 4 new required keys (so `npm test -w backend` boots without env-validation failures).
- [ ] `npm run typecheck -w backend` passes.
- [ ] `npm run lint` passes (no new violations).
- [ ] `npm run format:check` passes.

**Dependencies:** None (F01–F04 already on `main`).

---

### T2 — Backend JWT util (signJwt + verifyJwt via jose HS256)

**Batch:** B · **Depends on:** T1 · **Parallel with:** T3, T4

**Description:** Ship the JWT signing + verification module (D3, D4). `jose` v6 with HS256 symmetric key derived from `env.jwtSecret` via `createSecretKey(Buffer.from(JWT_SECRET))`. Constants for issuer/audience/TTL/clock-tolerance. This is the single source of truth for token shape — T5 (authenticate) and T6 (routes) both import from here.

Create / Modify:

- **`backend/src/utils/jwt.ts`** (NEW). Sign + verify. Constants co-located (SCREAMING_SNAKE_CASE per style guide).

  ```typescript
  import { SignJWT, jwtVerify, createSecretKey, type JWTPayload } from 'jose';
  import { env } from '../config';

  const JWT_ISSUER = 'slykboard';
  const JWT_AUDIENCE = 'slykboard-web';
  const JWT_TTL = '8h';
  const JWT_CLOCK_TOLERANCE = '30s';

  const secretKey = createSecretKey(Buffer.from(env.jwtSecret));

  export interface JwtUserClaims {
    sub: string;   // user.id (uuid)
    email: string;
    role: 'ADMIN' | 'MEMBER';
  }

  export function signJwt(claims: JwtUserClaims): Promise<string> {
    return new SignJWT({ email: claims.email, role: claims.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setExpirationTime(JWT_TTL)
      .sign(secretKey);
  }

  export async function verifyJwt(token: string): Promise<JwtUserClaims & JWTPayload> {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: JWT_CLOCK_TOLERANCE,
    });
    return payload as JwtUserClaims & JWTPayload;
  }
  ```

  Notes: (a) `createSecretKey(Buffer.from(...))` is the jose-recommended way to wrap an HS256 secret — avoids the `KeyObject` type confusion. (b) `setSubject(claims.sub)` sets the `sub` claim. (c) `clockTolerance: '30s'` handles the F05 spec edge case (clock skew). (d) `JwtUserClaims` is the typed payload T5/T6 consume. (e) `import type { JWTPayload }` per `verbatimModuleSyntax`.

- **`backend/src/utils/jwt.test.ts`** (NEW). Table-driven. Describe cases as scenario names (do NOT paste full test bodies):

  - **signs and verifies a valid token** — sign `{sub, email, role}`, verify, assert `payload.sub/email/role/iss/aud` match, `exp` is ~8h ahead.
  - **rejects a tampered token** — flip one char in the signature, `verifyJwt` rejects (JWSSignatureVerificationFailed).
  - **rejects an expired token** — sign with `setExpirationTime('0s')`, wait 1.1s (or use `jest.useFakeTimers` equivalent — vitest `vi.useFakeTimers`), verify rejects (JWTExpired). **Note:** `clockTolerance: '30s'` means tokens expiring within 30s still pass — test with `'-31s'` to force rejection.
  - **rejects wrong issuer** — sign with `setIssuer('evil')`, verify rejects (JWTClaimValidationFailed).
  - **rejects wrong audience** — sign with `setAudience('evil')`, verify rejects.
  - **throws on malformed (non-JWT) string** — `verifyJwt('not-a-jwt')` rejects with a jose error (JWSSignatureVerificationFailed or JWTMalformed).

**Acceptance Criteria:**
- [ ] `jwt.ts` exports `signJwt(claims: JwtUserClaims): Promise<string>` + `verifyJwt(token: string): Promise<JwtUserClaims & JWTPayload>`.
- [ ] Tokens carry `sub`, `email`, `role`, `iat`, `exp`, `iss: 'slykboard'`, `aud: 'slykboard-web'`.
- [ ] `exp` is 8h after `iat`.
- [ ] `verifyJwt` enforces issuer, audience, and `clockTolerance: '30s'`.
- [ ] All 6 test scenarios above pass.
- [ ] `npm run typecheck -w backend`, `npm run lint` pass.

**Dependencies:** T1 (`jose` installed, `env.jwtSecret` available).

---

### T3 — Backend Google OAuth service (exchangeCodeForUser + verifyIdToken)

**Batch:** B · **Depends on:** T1 · **Parallel with:** T2, T4

**Description:** Ship the Google-facing service (D1, D5, D6, D7). Singleton `OAuth2Client` at `config/googleClient.ts` (one TLS handshake pool — never per-request). `services/googleOAuth.ts` exports `exchangeCodeForUser(code)` which (1) calls `client.getToken(code)` to exchange the one-time auth code for Google tokens, (2) calls `client.verifyIdToken({idToken, audience})` to verify the ID token's signature + audience + issuer + expiry, (3) normalizes the payload to `{googleId, email, fullName, avatarUrl}`. Any failure throws `AppError('INTERNAL_ERROR', 'Authentication failed', {cause})` — never leaks Google's error messages (D7).

Create / Modify:

- **`backend/src/config/googleClient.ts`** (NEW). Singleton `OAuth2Client`.

  ```typescript
  import { OAuth2Client } from 'google-auth-library';
  import { env } from './env';

  // Singleton — reuses TLS connection pool. Tests vi.mock this module.
  export const googleClient = new OAuth2Client(
    env.googleClientId,
    env.googleClientSecret,
    env.googleCallbackUrl,  // 'postmessage' per D6
  );
  ```

  Notes: (a) `OAuth2Client` constructor takes `(clientId, clientSecret, redirectUri)`. (b) `redirectUri` MUST match what's registered in Google Cloud Console — for GIS popup flow, that's the literal string `postmessage` (D6). (c) Module-level singleton — `globalThis` caching is unnecessary here (unlike the pg `Pool` in `db/client.ts`) because `OAuth2Client` doesn't hold OS resources that survive HMR.

- **`backend/src/services/googleOAuth.ts`** (NEW). `exchangeCodeForUser`.

  ```typescript
  import { googleClient } from '../config/googleClient';
  import { env } from '../config/env';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';

  export interface GoogleUserInfo {
    googleId: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;  // nullable per schema.ts:13
  }

  export async function exchangeCodeForUser(code: string): Promise<GoogleUserInfo> {
    try {
      const { tokens } = await googleClient.getToken(code);
      const idToken = tokens.id_token;
      if (!idToken) throw new Error('No id_token in Google response');

      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: env.googleClientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload?.email) {
        throw new Error('Google payload missing sub or email');
      }
      return {
        googleId: payload.sub,
        email: payload.email,
        fullName: payload.name ?? payload.email.split('@')[0]!,
        avatarUrl: payload.picture ?? null,
      };
    } catch (cause) {
      // D7: never leak Google's error to the client — generic message.
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Authentication failed', { cause });
    }
  }
  ```

  Notes: (a) `getToken(code)` exchanges the one-time auth code for `{access_token, id_token, ...}`. (b) `verifyIdToken({idToken, audience})` checks signature + `aud` + `iss` + `exp` in one call (D5). (c) `payload.sub` is the stable Google user ID (maps to `users.googleId`). (d) `payload.name` can be undefined — fall back to email local-part (D15 edge case). (e) `payload.picture` can be undefined — store `null` (schema nullable). (f) The `try/catch` wraps ALL Google calls — network errors, invalid codes, expired tokens, audience mismatch all become `AppError('INTERNAL_ERROR', 'Authentication failed')`. (g) `cause` is passed to `AppError` for server-side logging (pino redacts `*.token` per `config/logger.ts:8-15`) but never serialized to the client (envelope only sends `code`/`message`/`details?`).

- **`backend/src/services/googleOAuth.test.ts`** (NEW). Mock `googleClient` module. Scenario names:

  - **returns normalized user info on success** — mock `getToken` → `{tokens: {id_token: 'x'}}`, mock `verifyIdToken` → `{getPayload: () => ({sub: 'g1', email: 'a@b.com', name: 'A B', picture: 'url'})}`; assert result `{googleId: 'g1', email: 'a@b.com', fullName: 'A B', avatarUrl: 'url'}`.
  - **falls back to email local-part when name missing** — payload `{sub, email}` (no `name`); assert `fullName === 'a'` (local-part of `a@b.com`).
  - **stores null avatarUrl when picture missing** — payload without `picture`; assert `avatarUrl === null`.
  - **throws AppError INTERNAL_ERROR on getToken rejection** — mock `getToken` rejects; assert `AppError` with `code: 'INTERNAL_ERROR'`, `message: 'Authentication failed'`.
  - **throws AppError INTERNAL_ERROR on verifyIdToken rejection** — mock `verifyIdToken` rejects; assert same.
  - **throws AppError INTERNAL_ERROR when id_token missing** — mock `getToken` → `{tokens: {}}`; assert same.
  - **never leaks Google error message** — mock `getToken` rejects with `new Error('invalid_grant: bad code')`; assert the thrown `AppError.message === 'Authentication failed'` (NOT the upstream message).

**Acceptance Criteria:**
- [ ] `googleClient.ts` exports a singleton `OAuth2Client` configured with `env.googleClientId`, `env.googleClientSecret`, `env.googleCallbackUrl`.
- [ ] `googleOAuth.ts` exports `exchangeCodeForUser(code: string): Promise<GoogleUserInfo>`.
- [ ] `GoogleUserInfo.avatarUrl` is `string | null` (nullable).
- [ ] All 7 test scenarios above pass.
- [ ] No Google error message reaches the thrown `AppError.message` (D7).
- [ ] `npm run typecheck -w backend`, `npm run lint` pass.

**Dependencies:** T1 (`google-auth-library` installed, `env.google*` available).

---

### T4 — Backend user upsert service (upsertByGoogleId)

**Batch:** B · **Depends on:** T1 · **Parallel with:** T2, T3

**Description:** Ship the user persistence layer (D9, D8). `services/userService.ts` exports `upsertByGoogleId({googleId, email, fullName, avatarUrl})` which inserts a new row OR updates email/fullName/avatarUrl on conflict (D9 — refresh every login). Uses Drizzle `onConflictDoUpdate({target: users.googleId, set: {...}})`. Returns the full user row (including `id`, `role`, timestamps) so T6 can sign the JWT with `user.id` + `user.role`.

Create / Modify:

- **`backend/src/services/userService.ts`** (NEW). Upsert.

  ```typescript
  import { eq } from 'drizzle-orm';
  import { db } from '../db/client';
  import { users } from '../db/schema';
  import type { GoogleUserInfo } from './googleOAuth';

  export type UpsertUserInput = GoogleUserInfo;

  // D9: insert-or-update on googleId. Refreshes email/fullName/avatarUrl every login.
  // Returns the full row (including id, role, timestamps) for JWT signing.
  export async function upsertByGoogleId(input: UpsertUserInput) {
    const [row] = await db
      .insert(users)
      .values({
        googleId: input.googleId,
        email: input.email,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl,
      })
      .onConflictDoUpdate({
        target: users.googleId,
        set: {
          email: input.email,
          fullName: input.fullName,
          avatarUrl: input.avatarUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row!;
  }
  ```

  Notes: (a) `.returning()` returns the inserted/updated row including the DB-generated `id` (uuid) + `role` (defaults to `'MEMBER'` on insert per `schema.ts:14`, preserved on conflict). (b) `row!` is safe because `returning()` yields exactly one row for a single `.values()` input. (c) `updatedAt: new Date()` is explicit (Drizzle's `$onUpdate` hook in `schema.ts:20` fires on ORM updates, but being explicit here is defensive and matches D9). (d) `import type { GoogleUserInfo }` from T3's module — T4 and T3 are parallel, so T4 may stub the type locally during dev and swap at merge; or T3 merges first. (e) Default role `'MEMBER'` (D8) — first-user ADMIN promotion is F06.

- **`backend/src/services/userService.test.ts`** (NEW). Mock `db` (the drizzle chain). Scenario names:

  - **inserts a new user and returns the row** — mock `db.insert.returning` → `[{id: 'u1', googleId: 'g1', email: 'a@b.com', fullName: 'A', avatarUrl: null, role: 'MEMBER', createdAt, updatedAt}]`; assert `result.id === 'u1'`, `result.role === 'MEMBER'`.
  - **updates email/name/avatar on conflict** — call twice with same `googleId` but different `email`/`fullName`/`avatarUrl`; assert the mock received `.onConflictDoUpdate` with the new values in `set`.
  - **preserves role on conflict** — mock returns `{role: 'ADMIN'}` (simulating an existing admin); assert the upsert does NOT include `role` in the `set` clause (role is never overwritten by login).
  - **preserves id on conflict** — assert `set` does NOT include `id`.
  - **passes null avatarUrl through** — input `{avatarUrl: null}`; assert `.values({...avatarUrl: null...})` called.

  Notes: Mocking the Drizzle chain (`db.insert().values().onConflictDoUpdate().returning()`) requires either (a) a manual mock object with chained methods, or (b) `vi.mock('../db/client')` returning a `db` object where every chain method returns `this` and `.returning()` returns a promise. Pattern (b) is preferred — co-locate the mock factory in the test file.

**Acceptance Criteria:**
- [ ] `userService.ts` exports `upsertByGoogleId(input): Promise<typeof users.$inferSelect>`.
- [ ] Uses `.onConflictDoUpdate({target: users.googleId, set: {email, fullName, avatarUrl, updatedAt}})`.
- [ ] `set` clause does NOT include `id` or `role` (preserved on conflict).
- [ ] All 5 test scenarios above pass.
- [ ] `npm run typecheck -w backend`, `npm run lint` pass.

**Dependencies:** T1 (`db` client from F02, schema from F02). Type import from T3 (`GoogleUserInfo`) — stub during parallel dev if T3 hasn't merged.

---

### T5 — Backend `authenticate` middleware

**Batch:** C · **Depends on:** T2 · **Parallel with:** T6 (prep only — T6 cannot merge until T5 is on `main`)

**Description:** Ship the `authenticate` middleware (D12) that protects routes requiring a logged-in user. Reads `Authorization: Bearer <jwt>` (case-insensitive scheme), calls `verifyJwt` (T2), attaches `req.user = {id, email, role}`. Throws `AppError('UNAUTHENTICATED', 'Missing or invalid token')` on missing/malformed/invalid tokens. Augment Express's `Request` type via `types/express.d.ts` so downstream handlers get type-safe `req.user`.

Create / Modify:

- **`backend/src/types/express.d.ts`** (NEW). Augment `Request`.

  ```typescript
  import type { Request } from 'express';

  export interface AuthenticatedUser {
    id: string;
    email: string;
    role: 'ADMIN' | 'MEMBER';
  }

  declare module 'express-serve-static-core' {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
  ```

  Notes: (a) Augmenting `express-serve-static-core` (the engine module Express re-exports) is the canonical way to add a property to `Request` across the whole app. (b) `user?` is optional — middleware that doesn't run `authenticate` won't set it. (c) `verbatimModuleSyntax`: `import type` only. (d) File must be picked up by `tsconfig.json` — confirm `include` covers `src/types/**/*` (F01's backend `tsconfig.json` includes `src` by default).

- **`backend/src/middleware/auth.ts`** (NEW). Authenticate.

  ```typescript
  import type { Request, Response, NextFunction } from 'express';
  import { verifyJwt } from '../utils/jwt';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';

  // D12: reads Authorization: Bearer <jwt> (case-insensitive scheme).
  // On success, attaches req.user = {id, email, role}.
  export async function authenticate(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }

    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }
    const token = match[1]!;

    try {
      const payload = await verifyJwt(token);
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
      next();
    } catch {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
    }
  }
  ```

  Notes: (a) `/^Bearer\s+(.+)$/i` — the `i` flag makes the scheme match case-insensitive (`bearer`, `BEARER`, `Bearer` all pass). (b) `match[1]!` — the `noUncheckedIndexedAccess` flag makes `match[1]` return `string | undefined`; the `!` is safe because the regex guarantees group 1 matched. (c) `try/catch` around `verifyJwt` — any jose error (expired, tampered, wrong issuer) becomes the same generic `UNAUTHENTICATED` (D7 — don't leak why the token failed). (d) `next()` only on success. (e) This is an `async` function — Express 5 catches rejected promises automatically (unlike Express 4); no `try/catch` wrapper needed for the `throw`s.

- **`backend/src/middleware/auth.test.ts`** (NEW). Table-driven. Scenario names:

  - **attaches req.user on valid token** — sign a real JWT via `signJwt`, set `req.headers.authorization = 'Bearer <jwt>'`, call `authenticate`, assert `req.user` === `{id, email, role}` and `next` called.
  - **throws UNAUTHENTICATED on missing header** — no `authorization` header; assert `AppError` w/ `code: 'UNAUTHENTICATED'`.
  - **throws UNAUTHENTICATED on malformed scheme** — header `'Basic abc'` or `'Bearer'` (no token); assert same.
  - **throws UNAUTHENTICATED on expired token** — sign with `setExpirationTime('-31s')` (beyond 30s tolerance); assert same.
  - **throws UNAUTHENTICATED on tampered token** — flip a char in the signature; assert same.
  - **accepts lowercase scheme** — header `'bearer <valid-jwt>'`; assert `next` called + `req.user` set.
  - **does not leak verifyJwt error in message** — expired token case; assert `err.message === 'Missing or invalid token'` (NOT the jose error text).

**Acceptance Criteria:**
- [ ] `express.d.ts` augments `Request` with optional `user?: AuthenticatedUser`; `tsc` picks it up (no "Property 'user' does not exist on type 'Request'" errors).
- [ ] `authenticate` reads `Authorization: Bearer <jwt>` case-insensitively, calls `verifyJwt`, attaches `req.user`.
- [ ] All failure paths throw `AppError('UNAUTHENTICATED', 'Missing or invalid token')`.
- [ ] All 7 test scenarios above pass.
- [ ] `npm run typecheck -w backend`, `npm run lint` pass.

**Dependencies:** T2 (`verifyJwt`).

---

### T6 — Backend auth routes (POST /google, GET /me, POST /logout) + mount

**Batch:** C (terminal backend) · **Depends on:** T2, T3, T4, T5 · **Parallel with:** —

**Description:** Ship the three auth routes and mount the router in `index.ts` (D11, D10). `POST /google` is the login entrypoint: validate body → exchange code → upsert user → sign JWT → return `{data: {token, user}}`. `GET /me` is the session-check: `authenticate` → re-sign a fresh JWT → return `{data: {token, user}}` (re-signing gives the client a fresh 8h window on each `/me` call — cheap UX win). `POST /logout` is a stateless no-op (D10): returns `{data: {success: true}}`; the frontend `useAuthStore.clear()` is authoritative.

Create / Modify:

- **`backend/src/routes/auth.schema.ts`** (NEW). Zod 4 schema co-located per F03 pattern.

  ```typescript
  import { z } from 'zod';

  // POST /api/auth/google body
  export const authCodeSchema = z.object({
    code: z.string().min(1),
  });
  ```

  Notes: (a) Zod 4 syntax (`z.object`, `z.string().min(1)`). (b) `validateRequest` in F03 (`middleware/validateRequest.ts:33-66`) strips unknown keys + throws `VALIDATION_FAILED` on bad input. (c) Co-located in `routes/` per F03 D-pattern.

- **`backend/src/routes/auth.routes.ts`** (NEW). Router with 3 routes.

  ```typescript
  import { Router } from 'express';
  import { success } from '../utils/envelope';
  import { validateRequest } from '../middleware/validateRequest';
  import { authenticate } from '../middleware/auth';
  import { signJwt } from '../utils/jwt';
  import { exchangeCodeForUser } from '../services/googleOAuth';
  import { upsertByGoogleId } from '../services/userService';
  import { authCodeSchema } from './auth.schema';

  export const authRouter = Router();

  authRouter.post('/google', validateRequest(authCodeSchema), async (req, res) => {
    const { code } = req.body as { code: string };
    const info = await exchangeCodeForUser(code);
    const user = await upsertByGoogleId(info);
    const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
    res.json(success({
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, avatarUrl: user.avatarUrl, role: user.role },
    }));
  });

  authRouter.get('/me', authenticate, async (req, res) => {
    const token = await signJwt({ sub: req.user!.id, email: req.user!.email, role: req.user!.role });
    res.json(success({ token, user: req.user }));
  });

  authRouter.post('/logout', (_req, res) => {
    // D10: stateless JWT — logout is a client-side action. No denylist.
    res.json(success({ success: true }));
  });
  ```

  Notes: (a) `validateRequest(authCodeSchema)` runs before the handler — throws `VALIDATION_FAILED` on missing/empty `code`. (b) `req.body as {code: string}` is safe because `validateRequest` overwrote `req.body` with the parsed (typed, stripped) value. (c) `req.user!` on `/me` is safe because `authenticate` ran and set it (or threw). (d) `/me` re-signs a fresh JWT so the client gets a new 8h window on every check — this is a cheap UX win (no refresh-token machinery needed until F07). (e) `/logout` is a no-op returning `{data: {success: true}}` (D10); the frontend `useAuthStore.clear()` is authoritative. (f) `user.avatarUrl` is `string | null` — the envelope `success(...)` serializes `null` fine.

- **`backend/src/index.ts`** (MODIFY — one-line mount). Insert between `:46` (`app.use('/api', pingRouter)`) and `:49` (`app.use(notFound)`).

  ```typescript
  // F05: auth routes — mount BEFORE notFound or /api/auth/* returns 404.
  app.use('/api/auth', authRouter);
  ```

  Add the import near the existing router imports (`:12` area): `import { authRouter } from './routes/auth.routes';`. Notes: (a) Order is load-bearing — must be before `notFound` (`:49`). (b) After `pingRouter` (`:46`) is fine (ping and auth are disjoint paths). (c) This is the ONLY line F05 touches in `index.ts`; CORS (`:20-28`) already permits `Authorization` + `credentials:true`.

- **`backend/src/routes/auth.routes.test.ts`** (NEW). Supertest + `vi.mock`. Scenario names:

  - **POST /google returns 200 with token + user on valid code** — mock `exchangeCodeForUser` → `{googleId, email, fullName, avatarUrl}`, mock `upsertByGoogleId` → `{id, email, fullName, avatarUrl, role}`, mock `signJwt` → `'jwt-xyz'`; POST `{code: 'valid'}`; assert `200`, body `{data: {token: 'jwt-xyz', user: {id, email, fullName, avatarUrl, role}}}`.
  - **POST /google returns 400 VALIDATION_FAILED on missing code** — POST `{}`; assert `400`, `body.error.code === 'VALIDATION_FAILED'`.
  - **POST /google returns 400 VALIDATION_FAILED on empty code** — POST `{code: ''}`; assert same.
  - **POST /google returns 500 INTERNAL_ERROR when exchangeCodeForUser throws** — mock rejects with `AppError('INTERNAL_ERROR', 'Authentication failed')`; assert `500`, `body.error.code === 'INTERNAL_ERROR'`, `body.error.message === 'Authentication failed'`.
  - **GET /me returns 401 UNAUTHENTICATED without token** — no `Authorization` header; assert `401`, `body.error.code === 'UNAUTHENTICATED'`.
  - **GET /me returns 200 with fresh token + user on valid token** — sign a real JWT, set header; assert `200`, `body.data.token` present, `body.data.user` matches JWT claims.
  - **POST /logout returns 200 with success:true** — assert `200`, `body.data.success === true`.

  Notes: Mock the three service modules (`googleOAuth`, `userService`, `jwt`) with `vi.mock('../services/googleOAuth', () => ({exchangeCodeForUser: vi.fn()}))` etc. Use supertest's `app` export from `backend/src/index.ts` (`:95` exports `app`). The `/me` test needs a real signed JWT — import `signJwt` directly (don't mock it for that one test) so `authenticate`'s `verifyJwt` passes.

**Acceptance Criteria:**
- [ ] `auth.schema.ts` exports `authCodeSchema` (Zod 4 `{code: z.string().min(1)}`).
- [ ] `auth.routes.ts` exports `authRouter` with `POST /google`, `GET /me`, `POST /logout`.
- [ ] `POST /google` returns `{data: {token, user}}` on success; `user` has `{id, email, fullName, avatarUrl, role}`.
- [ ] `GET /me` requires `authenticate`; returns `{data: {token, user}}` with a freshly-signed JWT.
- [ ] `POST /logout` returns `{data: {success: true}}` (no-op).
- [ ] `index.ts` mounts `app.use('/api/auth', authRouter)` before `notFound`.
- [ ] All 7 test scenarios above pass.
- [ ] `npm run typecheck -w backend`, `npm run lint` pass.
- [ ] Error responses use the F03 envelope (`{error: {code, message}}`), never raw strings.

**Dependencies:** T2 (`signJwt`, `verifyJwt` via `authenticate`), T3 (`exchangeCodeForUser`), T4 (`upsertByGoogleId`), T5 (`authenticate`).

---

### T7 — Frontend env + GoogleOAuthProvider

**Batch:** A · **Depends on:** None · **Parallel with:** T1, T8

**Description:** Install `@react-oauth/google` (the GIS React wrapper, owner pick per `persona.md`) + `jose` (for client-side JWT `exp` decode in T9). Add `VITE_GOOGLE_CLIENT_ID` to the frontend env reader + `ImportMetaEnv` augmentation. Wrap the app in `<GoogleOAuthProvider>` in `main.tsx` — position it INSIDE `StrictMode` but OUTSIDE `ErrorBoundary` so a GIS init failure doesn't crash the whole app boundary.

Create / Modify:

- **`frontend/package.json`** (MODIFY). Install from repo root:

  ```bash
  npm install -w frontend @react-oauth/google jose
  ```

  Runtime pins: `@react-oauth/google ^0.13` (D1 — `flow: 'auth-code'` popup), `jose ^6` (D14 — `decodeJwt` for client-side `exp` hint; same version as backend for consistency).

- **`frontend/.env.example`** (MODIFY). Add `VITE_GOOGLE_CLIENT_ID`.

  ```
  # F04: required for the app shell.
  VITE_API_BASE_URL=http://localhost:3000/api
  # F05: Google OAuth Client ID (from Google Cloud Console → Credentials → OAuth 2.0 Client ID).
  # This is the PUBLIC client ID (safe to expose); the secret stays backend-only.
  VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
  ```

- **`frontend/src/vite-env.d.ts`** (MODIFY). Augment `ImportMetaEnv`.

  ```typescript
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
    readonly VITE_GOOGLE_CLIENT_ID: string;
  }
  ```

- **`frontend/src/config/env.ts`** (MODIFY). Add `googleClientId`.

  ```typescript
  interface EnvConfig {
    readonly apiBaseUrl: string;
    readonly googleClientId: string;
  }

  function loadEnv(): EnvConfig {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
    if (!apiBaseUrl) throw new Error('Missing VITE_API_BASE_URL');
    const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!googleClientId) throw new Error('Missing VITE_GOOGLE_CLIENT_ID');
    return { apiBaseUrl, googleClientId };
  }

  export const env: EnvConfig = Object.freeze(loadEnv());
  ```

  Notes: Fail-fast matches the existing `apiBaseUrl` pattern (`:6-9`).

- **`frontend/src/main.tsx`** (MODIFY). Wrap with `<GoogleOAuthProvider>`.

  ```tsx
  import { StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClientProvider } from '@tanstack/react-query';
  import { RouterProvider } from 'react-router';
  import { GoogleOAuthProvider } from '@react-oauth/google';
  import { queryClient } from '@/lib/queryClient';
  import { ErrorBoundary } from '@/components/ErrorBoundary';
  import { router } from '@/routes';
  import { env } from '@/config/env';
  import './index.css';

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Missing #root element');

  createRoot(rootElement).render(
      <StrictMode>
          <GoogleOAuthProvider clientId={env.googleClientId}>
              <ErrorBoundary>
                  <QueryClientProvider client={queryClient}>
                      <RouterProvider router={router} />
                  </QueryClientProvider>
              </ErrorBoundary>
          </GoogleOAuthProvider>
      </StrictMode>,
  );
  ```

  Notes: (a) **Provider order is load-bearing**: `StrictMode` (outermost) → `GoogleOAuthProvider` → `ErrorBoundary` → `QueryClientProvider` → `RouterProvider`. GIS is inside `StrictMode` (so dev-mode double-render doesn't double-init — `GoogleOAuthProvider` is idempotent) but OUTSIDE `ErrorBoundary` (so a GIS script-load failure doesn't blank the whole app — the `LoginPage` can render a fallback "Google login unavailable" message inside the boundary). (b) `clientId={env.googleClientId}` — reads from the typed config module, not `import.meta.env` directly (F04 D5 convention). (c) Import order per style guide: external (react, react-dom, @tanstack, react-router, @react-oauth/google) → internal (@/lib, @/components, @/routes, @/config) → side-effect (./index.css).

**Acceptance Criteria:**
- [ ] `npm install` succeeds; `frontend/package.json` lists `@react-oauth/google ^0.13` + `jose ^6` in `dependencies`.
- [ ] `frontend/.env.example` has `VITE_GOOGLE_CLIENT_ID` with a comment.
- [ ] `frontend/src/vite-env.d.ts` augments `ImportMetaEnv` with `VITE_GOOGLE_CLIENT_ID: string`.
- [ ] `frontend/src/config/env.ts` exports `env.googleClientId`; throws on missing.
- [ ] `main.tsx` wraps the app in `<GoogleOAuthProvider clientId={env.googleClientId}>` inside `StrictMode`, outside `ErrorBoundary`.
- [ ] `npm run typecheck -w frontend`, `npm run lint` pass.

**Dependencies:** None (F04 already on `main`).

---

### T8 — Frontend auth store hardening (persist + extended AuthUser)

**Batch:** A · **Depends on:** None · **Parallel with:** T1, T7

**Description:** Extend `AuthUser` to carry the full user shape the backend now returns (`id`, `role`, `avatarUrl`) and add Zustand `persist` middleware so the token survives page reload (D2). The existing `apiFetch` already reads `user.token` — adding `persist` means reloads no longer reset to unauthenticated.

Create / Modify:

- **`frontend/src/stores/useAuthStore.ts`** (MODIFY). Extend `AuthUser` + add `persist`.

  ```typescript
  import { create } from 'zustand';
  import { persist } from 'zustand/middleware';

  export interface AuthUser {
      token: string;
      id: string;
      email: string;
      name: string;           // maps from backend fullName
      role: 'ADMIN' | 'MEMBER';
      avatarUrl: string | null;
  }

  interface AuthState {
      user: AuthUser | null;
      setUser: (user: AuthUser | null) => void;
      clear: () => void;
  }

  // D2: persist user (incl. token) to localStorage. Accepted XSS tradeoff — F07 hardens.
  export const useAuthStore = create<AuthState>()(
      persist(
          (set) => ({
              user: null,
              setUser: (user) => set({ user }),
              clear: () => set({ user: null }),
          }),
          {
              name: 'slyk-auth',
              partialize: (state) => ({ user: state.user }),
          },
      ),
  );
  ```

  Notes: (a) `create<AuthState>()(persist(...))` — the curried form is required when using middleware in Zustand v5. (b) `partialize: (state) => ({user: state.user})` — only persists the `user` object (not `setUser`/`clear`, which are functions). (c) `name: 'slyk-auth'` is the localStorage key. (d) `AuthUser` now has `id`, `role`, `avatarUrl` — T10's `LoginPage` maps the backend response into this shape; T12's `TopNav` reads `avatarUrl`/`name`/`role`. (e) `avatarUrl: string | null` matches the backend (schema nullable). (f) `name` maps from backend `fullName` (key rename — frontend convention is `name` for display).

- **`frontend/src/stores/useAuthStore.test.ts`** (MODIFY — update for new shape + persist). Scenario names:

  - **starts with null user** — assert `useAuthStore.getState().user === null`.
  - **setUser stores the full AuthUser** — `setUser({token, id, email, name, role, avatarUrl})`; assert all fields readable.
  - **clear nulls the user** — setUser then clear; assert `user === null`.
  - **persists user to localStorage under 'slyk-auth' key** — setUser; assert `JSON.parse(localStorage.getItem('slyk-auth')!).state.user` matches. (Requires jsdom environment which Vitest already uses per `vite.config.ts`.)
  - **rehydrates from localStorage on store recreation** — setUser, then simulate reload by clearing the module cache + re-importing; assert user is restored. (Or: assert `persist` middleware is configured with `name: 'slyk-auth'`.)
  - **does NOT persist setUser/clear functions** — assert the persisted blob only has `state.user`, not `setUser`/`clear` (partialize check).

  Notes: `beforeEach` should call `localStorage.clear()` + `useAuthStore.getState().clear()` to isolate tests. Zustand `persist` reads localStorage synchronously on store creation, so the test can assert immediately after `setUser`.

**Acceptance Criteria:**
- [ ] `AuthUser` has `{token, id, email, name, role, avatarUrl: string|null}`.
- [ ] Store uses `persist` middleware with `name: 'slyk-auth'`, `partialize: (s) => ({user: s.user})`.
- [ ] All 6 test scenarios above pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint` pass.

**Dependencies:** None (F04's `useAuthStore` skeleton exists). The `setUser` callers in F04's `LoginPage.tsx:9-13` pass a 3-field object — T10 updates `LoginPage` to pass the full 6-field shape. T8 is backwards-compatible at the type level (new fields are required, so T10 MUST land to keep typecheck green — document this).

---

### T9 — Frontend RequireAuth harden (JWT exp decode + auto-clear)

**Batch:** D · **Depends on:** T8 · **Parallel with:** T10, T11, T12

**Description:** Harden `RequireAuth` beyond the F04 null-check (D14). Decode the JWT `exp` claim client-side via `jose` `decodeJwt` (which does NOT verify — it's a UX hint, not a security boundary). If the token is expired, call `clear()` + redirect `/login`. Keep the existing `state={{from: location}}` pattern so post-login redirect works. Backend `verifyJwt` (T5) remains the source of truth — the client check is purely UX (avoids showing authenticated UI with a dead token).

Create / Modify:

- **`frontend/src/components/RequireAuth.tsx`** (MODIFY). Add `exp` check.

  ```tsx
  import { Navigate, Outlet, useLocation } from 'react-router';
  import { decodeJwt } from 'jose';
  import { useAuthStore } from '@/stores/useAuthStore';

  function isTokenExpired(token: string): boolean {
      try {
          const payload = decodeJwt(token);
          if (!payload.exp) return false; // no exp = never expires (defensive)
          return Date.now() >= payload.exp * 1000;
      } catch {
          return true; // malformed = treat as expired
      }
  }

  export function RequireAuth() {
      const user = useAuthStore((state) => state.user);
      const clear = useAuthStore((state) => state.clear);
      const location = useLocation();

      if (!user || isTokenExpired(user.token)) {
          clear();
          return <Navigate to="/login" replace state={{ from: location }} />;
      }
      return <Outlet />;
  }
  ```

  Notes: (a) `decodeJwt` from `jose` — reads the payload WITHOUT verifying the signature (D14). This is safe because the backend is the security boundary; the client check just avoids a flash of authenticated UI before the next API call 401s. (b) `Date.now() >= payload.exp * 1000` — `exp` is in seconds (JWT convention), `Date.now()` is ms. (c) `clear()` on expiry — clears `localStorage['slyk-auth']` so the next reload doesn't re-hydrate the dead token. (d) `try/catch` around `decodeJwt` — malformed tokens (e.g. test fixtures) are treated as expired. (e) `clear()` inside the render body is technically a side effect — React 19 strict mode double-invokes it, but `clear()` is idempotent (sets `user: null`). Acceptable tradeoff; the alternative is `useEffect` which delays the redirect by a frame (worse UX).

- **`frontend/src/components/RequireAuth.test.tsx`** (MODIFY). Scenario names:

  - **redirects to /login when user is null** — don't setUser; assert `<Navigate to="/login">` rendered.
  - **renders Outlet when user has valid (non-expired) token** — setUser with a JWT signed via `signJwt` (or a hand-crafted JWT with `exp` far in the future); assert `<Outlet/>` rendered.
  - **clears + redirects when token is expired** — setUser with a JWT where `exp` is in the past; assert `clear()` called + `<Navigate to="/login">`.
  - **clears + redirects when token is malformed** — setUser with `{token: 'not-a-jwt'}`; assert same.
  - **preserves from: location in navigate state** — assert `state.from` is the current location.

  Notes: Tests need a real (or realistic) JWT. Options: (a) import `signJwt` from backend (cross-workspace import — messy), (b) hand-craft a JWT with `jose`'s `SignJWT` directly in the test, (c) use a fixed test fixture. Option (b) is cleanest — `new SignJWT({}).setExpirationTime('1h').sign(key)` in the test setup.

**Acceptance Criteria:**
- [ ] `RequireAuth` decodes JWT `exp` via `jose` `decodeJwt`.
- [ ] Expired/malformed token → `clear()` + `<Navigate to="/login">`.
- [ ] Valid token → `<Outlet/>`.
- [ ] `state={{from: location}}` preserved (F04 pattern intact).
- [ ] All 5 test scenarios above pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint` pass.

**Dependencies:** T8 (extended `AuthUser` with `token`). T7 installs `jose` (or T9 installs it — coordinate to avoid double-install; recommended: T7 owns the `jose` install since it also needs `@react-oauth/google`).

---

### T10 — Frontend LoginPage rewrite (useGoogleLogin auth-code flow)

**Batch:** D · **Depends on:** T7, T8 · **Parallel with:** T9, T11, T12

**Description:** Replace the F04 demo button with the real Google SSO flow (D1). Use `useGoogleLogin({flow: 'auth-code', onSuccess: async ({code}) => {...}})` — the GIS popup handles consent + PKCE + `postMessage`; we receive the one-time `code` and POST it to `/auth/google` (T11). On success: `setUser({token, id, email, name, role, avatarUrl})` + `navigate(from ?? '/')`. Tailwind styling with `bg-primary text-background`.

Create / Modify:

- **`frontend/src/pages/LoginPage.tsx`** (MODIFY — full rewrite).

  ```tsx
  import { useState } from 'react';
  import { useLocation, useNavigate } from 'react-router';
  import { useGoogleLogin } from '@react-oauth/google';
  import { useAuthStore } from '@/stores/useAuthStore';
  import { loginWithGoogle, type AuthResponse } from '@/api/auth';
  import type { ApiClientError } from '@/api/client';

  export function LoginPage() {
      const setUser = useAuthStore((s) => s.setUser);
      const navigate = useNavigate();
      const location = useLocation();
      const [error, setError] = useState<string | null>(null);

      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

      const handleLogin = useGoogleLogin({
          flow: 'auth-code',
          onSuccess: async ({ code }) => {
              try {
                  const { token, user } = await loginWithGoogle(code);
                  setUser({
                      token,
                      id: user.id,
                      email: user.email,
                      name: user.fullName,
                      role: user.role,
                      avatarUrl: user.avatarUrl,
                  });
                  navigate(from, { replace: true });
              } catch (err) {
                  setError(err instanceof ApiClientError ? err.message : 'Login failed');
              }
          },
          onError: () => setError('Google sign-in was cancelled or failed'),
      });

      return (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
              <h1 className="text-2xl font-semibold text-foreground">Sign in to Slykboard</h1>
              {error && (
                  <p role="alert" className="text-sm text-red-600">{error}</p>
              )}
              <button
                  type="button"
                  onClick={() => handleLogin()}
                  className="rounded bg-primary px-6 py-3 text-sm font-medium text-background"
              >
                  Sign in with Google
              </button>
          </div>
      );
  }
  ```

  Notes: (a) `useGoogleLogin({flow: 'auth-code'})` — GIS pops the consent window, handles PKCE internally, `postMessage`s the `code` back. (b) `onSuccess` receives `{code}` — the one-time auth code. (c) `loginWithGoogle(code)` is T11's wrapper (stub during parallel dev). (d) Backend response shape `{token, user: {id, email, fullName, avatarUrl, role}}` — map to `AuthUser` (key rename `fullName → name`). (e) `from` extraction is type-safe via the cast (D11 — hardcoded `/` fallback, never trusts unknown input). (f) `navigate(from, {replace: true})` — `replace` so back button doesn't return to `/login`. (g) `onError` handles GIS popup closed/denied. (h) Error display uses `role="alert"` (Testing Library priority). (i) Tailwind `bg-primary text-background` matches F04 tokens. (j) **No `--color-danger` token yet** (F04 `index.css:1-29` doesn't define it) — use `text-red-600` (Tailwind default palette) for the error message; F28 may add a `--color-danger` token later.

- **`frontend/src/pages/LoginPage.test.tsx`** (MODIFY — rewrite for real flow). Scenario names:

  - **renders Sign in with Google button** — assert `getByRole('button', {name: /sign in with google/i})`.
  - **calls loginWithGoogle with the auth code on success** — mock `@react-oauth/google`'s `useGoogleLogin` to invoke `onSuccess({code: 'test-code'})`; mock `@/api/auth`'s `loginWithGoogle`; click button; assert `loginWithGoogle` called with `'test-code'`.
  - **sets user + navigates on success** — assert `useAuthStore.getState().user` populated with mapped fields + `navigate` called with `from ?? '/'`.
  - **shows error on ApiClientError** — mock `loginWithGoogle` rejects with `ApiClientError`; assert error message rendered (`role="alert"`).
  - **shows error on GIS onError** — mock `useGoogleLogin` to invoke `onError()`; assert "cancelled or failed" message.
  - **respects from: location state** — render with `location.state = {from: {pathname: '/reports'}}`; assert `navigate` called with `/reports`.

  Notes: Mocking `@react-oauth/google` requires `vi.mock('@react-oauth/google', () => ({useGoogleLogin: vi.fn((opts) => () => { /* store opts for test invocation */ }))}))`. The test then invokes the captured `onSuccess`/`onError` to simulate GIS callbacks. Wrap in `<MemoryRouter>` or `<RouterProvider router={createMemoryRouter(...)}>` for `useNavigate`.

**Acceptance Criteria:**
- [ ] `LoginPage` renders "Sign in with Google" button.
- [ ] Click triggers `useGoogleLogin({flow: 'auth-code'})`.
- [ ] On `{code}`: calls `loginWithGoogle(code)` → `setUser(...)` → `navigate(from ?? '/')`.
- [ ] Error display uses `role="alert"`.
- [ ] All 6 test scenarios above pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint` pass.

**Dependencies:** T7 (`@react-oauth/google` installed, `GoogleOAuthProvider` in `main.tsx`), T8 (extended `AuthUser`). T11 (`loginWithGoogle`) — stub during parallel dev if T11 hasn't merged.

---

### T11 — Frontend api/auth.ts wrappers

**Batch:** D · **Depends on:** T8 · **Parallel with:** T9, T10, T12

**Description:** Ship the typed API wrappers for the three auth endpoints (T6). `loginWithGoogle(code)` POSTs to `/auth/google`, `fetchMe()` GETs `/auth/me`, `logout()` POSTs `/auth/logout` (best-effort, swallows errors per D10 — logout must succeed client-side even if the backend is down). All delegate to `apiFetch` (F04) which handles envelope unwrap + `Authorization` injection.

Create / Modify:

- **`frontend/src/api/auth.ts`** (NEW). Three wrappers + response types.

  ```typescript
  import { apiFetch } from './client';

  export interface AuthResponseUser {
      id: string;
      email: string;
      fullName: string;
      avatarUrl: string | null;
      role: 'ADMIN' | 'MEMBER';
  }

  export interface AuthResponse {
      token: string;
      user: AuthResponseUser;
  }

  export function loginWithGoogle(code: string): Promise<AuthResponse> {
      return apiFetch<AuthResponse>('/auth/google', {
          method: 'POST',
          body: JSON.stringify({ code }),
      });
  }

  export function fetchMe(): Promise<AuthResponse> {
      return apiFetch<AuthResponse>('/auth/me');
  }

  // D10: best-effort — never throw on logout (client-side clear is authoritative).
  export async function logout(): Promise<void> {
      try {
          await apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' });
      } catch {
          // Swallow — useAuthStore.clear() is the real logout.
      }
  }
  ```

  Notes: (a) `apiFetch` prepends `env.apiBaseUrl` (`http://localhost:3000/api`) — paths are `/auth/google` not `/api/auth/google`. (b) `apiFetch` auto-injects `Authorization: Bearer <token>` from the store — `fetchMe` works mid-session. (c) `loginWithGoogle` runs BEFORE the user has a token (unauthenticated) — `apiFetch` skips the `Authorization` header when `user?.token` is falsy (`client.ts:35-37`). (d) `logout` swallows ALL errors — if the backend is down, the frontend still clears localStorage and redirects. (e) `AuthResponseUser` mirrors the backend response shape (T6 returns `{id, email, fullName, avatarUrl, role}`). (f) `AuthResponse` is `{token, user}`. (g) `import type` for type-only exports per `verbatimModuleSyntax`.

- **`frontend/src/api/auth.test.ts`** (NEW). Mock `apiFetch`. Scenario names:

  - **loginWithGoogle POSTs {code} and returns AuthResponse** — mock `apiFetch` → `{token, user}`; call `loginWithGoogle('abc')`; assert `apiFetch` called with `'/auth/google'`, `{method: 'POST', body: JSON.stringify({code: 'abc'})}`.
  - **fetchMe GETs /auth/me** — mock; call `fetchMe()`; assert `apiFetch` called with `'/auth/me'` (no body).
  - **logout POSTs /auth/logout** — mock; call `logout()`; assert `apiFetch` called with `'/auth/logout'`, `{method: 'POST'}`.
  - **logout swallows errors** — mock `apiFetch` rejects; call `logout()`; assert it resolves (does not throw).
  - **loginWithGoogle propagates ApiClientError** — mock rejects with `ApiClientError`; assert `loginWithGoogle` rejects (does NOT swallow — only `logout` does).

**Acceptance Criteria:**
- [ ] `auth.ts` exports `loginWithGoogle`, `fetchMe`, `logout`, `AuthResponse`, `AuthResponseUser`.
- [ ] `logout` swallows all errors; `loginWithGoogle`/`fetchMe` propagate `ApiClientError`.
- [ ] All 5 test scenarios above pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint` pass.

**Dependencies:** T8 (`apiFetch` already exists from F04; T8 just extends the store it reads). None blocking — can branch as soon as F04 is on `main`. Listed under Batch D for grouping with other frontend tasks.

---

### T12 — Frontend TopNav logout + user display

**Batch:** D · **Depends on:** T8, T11 · **Parallel with:** T9, T10

**Description:** Update `TopNav` (F04) to show the signed-in user (avatar image when `avatarUrl` is set, initials fallback per D15 when null) and a "Sign out" button. On click: call `logout()` (T11, best-effort) → `useAuthStore.clear()` → `navigate('/login', {replace: true})`.

Create / Modify:

- **`frontend/src/components/TopNav.tsx`** (MODIFY). Add avatar + sign out.

  ```tsx
  import { useState } from 'react';
  import { NavLink, useNavigate } from 'react-router';
  import { useAuthStore } from '@/stores/useAuthStore';
  import { logout } from '@/api/auth';

  const NAV_LINKS = [
      { to: '/', label: 'Board', end: true },
      { to: '/reports', label: 'Reports', end: false },
      { to: '/settings', label: 'Settings', end: false },
  ] as const;

  function getInitials(name: string, email: string): string {
      const source = name || email.split('@')[0] || '?';
      return source.slice(0, 2).toUpperCase();
  }

  export function TopNav() {
      const [open, setOpen] = useState(false);
      const user = useAuthStore((s) => s.user);
      const clear = useAuthStore((s) => s.clear);
      const navigate = useNavigate();

      const handleSignOut = async () => {
          await logout();
          clear();
          navigate('/login', { replace: true });
      };

      return (
          <header className="border-b border-border bg-background">
              <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
                  <span className="text-lg font-semibold">Slykboard</span>
                  {/* ... existing hamburger + nav links ... */}
                  {user && (
                      <div className="flex items-center gap-3">
                          {user.avatarUrl ? (
                              <img src={user.avatarUrl} alt={user.name} className="h-8 w-8 rounded-full" />
                          ) : (
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-background">
                                  {getInitials(user.name, user.email)}
                              </span>
                          )}
                          <button type="button" onClick={handleSignOut} className="text-sm text-muted hover:text-foreground">
                              Sign out
                          </button>
                      </div>
                  )}
              </nav>
          </header>
      );
  }
  ```

  Notes: (a) `getInitials(name, email)` — D15 fallback. Uses `name` first, then email local-part, then `?`. (b) `user.avatarUrl` is `string | null` — conditional `<img>` vs initials span. (c) `handleSignOut` — `await logout()` (best-effort, T11 swallows), `clear()` (clears localStorage), `navigate('/login', {replace: true})`. (d) `alt={user.name}` for avatar accessibility. (e) Tailwind classes use F04 tokens (`bg-background`, `text-muted`, `text-foreground`, `border-border`, `bg-muted`). (f) The existing hamburger + nav links JSX (F04) is preserved — the snippet above elides it for brevity; only the new `<div>` block after the nav `<ul>` is added.

- **`frontend/src/components/TopNav.test.tsx`** (MODIFY). Scenario names:

  - **renders avatar img when avatarUrl is set** — setUser with `avatarUrl: 'http://img/url'`; assert `getByRole('img', {name: user.name})`.
  - **renders initials when avatarUrl is null** — setUser with `avatarUrl: null`, `name: 'Alice'`; assert initials text `'AL'` visible.
  - **initials fall back to email local-part when name empty** — setUser with `name: ''`, `email: 'bob@x.com'`; assert `'BO'`.
  - **Sign out button calls logout + clear + navigate** — mock `logout`; click "Sign out"; assert `logout` called, `useAuthStore.getState().user === null`, navigate called with `/login`.
  - **preserves nav links (Board/Reports/Settings)** — assert existing links still render (F04 regression check).

**Acceptance Criteria:**
- [ ] Avatar `<img>` renders when `avatarUrl` is set; initials fallback when null.
- [ ] Initials derived from `name` → email local-part → `?`.
- [ ] "Sign out" button calls `logout()` → `clear()` → `navigate('/login')`.
- [ ] All 5 test scenarios above pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint` pass.

**Dependencies:** T8 (extended `AuthUser`), T11 (`logout`).

---

### T13 — End-to-end smoke + Google Cloud Console setup docs

**Batch:** E · **Depends on:** T6, T9, T10, T11, T12 · **Parallel with:** —

**Description:** The manual end-to-end smoke proving the full F05 flow against a real Google OAuth client + live backend + live frontend. Document the Google Cloud Console setup so the next developer/integrator can reproduce. This is NOT automated — it's a human-in-the-loop verification gate (T14 is the automated gate).

**Steps:**

1. **Google Cloud Console setup (one-time):**
   - Go to https://console.cloud.google.com/ → APIs & Services → Credentials.
   - Create an OAuth 2.0 Client ID (Web application).
   - **Authorized JavaScript origins:** add `http://localhost:5173` (dev) + the prod Vercel URL (TBD).
   - **Authorized redirect URIs:** add `postmessage` (the literal string — D6). Do NOT add `http://localhost:...` here.
   - Copy the Client ID → `frontend/.env` as `VITE_GOOGLE_CLIENT_ID`.
   - Copy the Client Secret → `backend/.env` as `GOOGLE_CLIENT_SECRET`.
   - Set `GOOGLE_CLIENT_ID` in `backend/.env` (same value as frontend — it's the audience check).
   - Set `GOOGLE_CALLBACK_URL=postmessage` in `backend/.env`.

2. **Generate `JWT_SECRET`:**
   ```bash
   openssl rand -base64 48
   ```
   Set in `backend/.env` as `JWT_SECRET` (must be ≥32 chars per T1's validation).

3. **Boot dev servers:**
   ```bash
   docker compose up -d  # Postgres
   npm run dev:api       # backend :3000
   npm run dev:web       # frontend :5173
   ```

4. **Run the login flow:**
   - Open `http://localhost:5173` → expect redirect to `/login`.
   - Click "Sign in with Google" → GIS popup opens.
   - Select a Google account → consent.
   - Expect redirect to `/` (board placeholder).
   - TopNav shows avatar + "Sign out".

5. **Capture Network tab:**
   - Open DevTools → Network.
   - Find `POST /api/auth/google` → capture request body `{code: '...'}` + response body `{data: {token: '...', user: {...}}}`.
   - Paste the response into the §7 integration record.

6. **Decode the JWT:**
   - Copy the `token` from the response.
   - Paste into https://jwt.io.
   - Verify claims: `sub` (uuid), `email`, `role` (`MEMBER`), `iss: 'slykboard'`, `aud: 'slykboard-web'`, `exp` (~8h ahead).
   - Paste the decoded payload into the §7 integration record.

7. **Persistence check:**
   - With the user logged in, press F5 (reload).
   - Expect to stay on `/` (NOT redirected to `/login`) — `persist` rehydrated the token from localStorage.
   - TopNav still shows avatar.

8. **Logout check:**
   - Click "Sign out" in TopNav.
   - Expect redirect to `/login`.
   - DevTools → Application → Local Storage → `slyk-auth` key should be absent (or have `{state: {user: null}}`).

9. **Bad-code curl (error handling):**
   ```bash
   curl -X POST http://localhost:3000/api/auth/google \
     -H 'Content-Type: application/json' \
     -d '{"code": "invalid-code"}' -i
   ```
   Expect: `HTTP/1.1 500 Internal Server Error`, body `{"error":{"code":"INTERNAL_ERROR","message":"Authentication failed"}}`. **No stack trace, no Google error leak** (D7).

10. **Missing-code curl (validation):**
    ```bash
    curl -X POST http://localhost:3000/api/auth/google \
      -H 'Content-Type: application/json' \
      -d '{}' -i
    ```
    Expect: `HTTP/1.1 400 Bad Request`, body `{"error":{"code":"VALIDATION_FAILED","message":"Request validation failed","details":{...}}}`.

11. **Update root `README.md`** if it references env vars (add the 5 new backend keys + `VITE_GOOGLE_CLIENT_ID`).

**Acceptance Criteria:**
- [ ] Google Cloud Console OAuth client configured (JS origins + `postmessage` redirect).
- [ ] Login flow completes end-to-end (button → popup → consent → redirect `/` → avatar visible).
- [ ] `POST /api/auth/google` response captured in §7.
- [ ] JWT decoded at jwt.io; claims match D4.
- [ ] F5 reload preserves session (persist works).
- [ ] Logout clears localStorage + redirects `/login`.
- [ ] Bad-code curl returns 500 `INTERNAL_ERROR` (no stack trace, no Google error leak).
- [ ] Missing-code curl returns 400 `VALIDATION_FAILED`.
- [ ] `README.md` updated with new env vars (if applicable).

**Dependencies:** T6 (backend routes live), T9 (RequireAuth harden), T10 (LoginPage rewrite), T11 (api wrappers), T12 (TopNav logout).

---

### T14 — Integration verification & sign-off

**Batch:** E (terminal) · **Depends on:** T13 · **Parallel with:** —

**Description:** The final automated definition-of-done gate. Run every tool against the as-merged feature, verify security mandates, fill the integration record in §7. This task owns no files — it's pure verification + documentation.

**Steps:**

1. **Clean tree check:**
   ```bash
   git status  # should be clean (all F05 commits on main)
   ```

2. **Lint + format + typecheck + test (all workspaces):**
   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm test -ws
   ```
   All exit 0. **Note:** pre-existing `backend/src/db.test.ts` Postgres auth failures (`28P01` password auth for user "test") from F02 are NOT F05 regressions — document this in the integration record. F05 adds no new DB-touching tests that would compound this.

3. **Build both workspaces:**
   ```bash
   npm run build -w backend
   npm run build -w frontend
   ```
   Both produce `dist/`. Backend `tsc -p tsconfig.json` → `backend/dist/`. Frontend `tsc -b && vite build` → `frontend/dist/`.

4. **Env example completeness:**
   - `backend/.env.example` has all 5 new keys (`JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL=postmessage`, `ALLOWED_DOMAIN=`).
   - `frontend/.env.example` has `VITE_GOOGLE_CLIENT_ID`.
   - No real secrets committed (`.env` gitignored per `git-guidelines.md`).

5. **Error code vocabulary unchanged:**
   - `backend/src/utils/envelope.ts:5-12` still lists exactly the 6 F03 codes. F05 uses `UNAUTHENTICATED`, `VALIDATION_FAILED`, `INTERNAL_ERROR` — no new codes added.

6. **No schema delta:**
   - `backend/src/db/schema.ts:8-22` unchanged from F02. F05 adds no migrations.

7. **Security mandates:**
   - No `console.log` in production code (grep `console\.` in `backend/src` + `frontend/src`).
   - No raw SQL (F05 uses Drizzle query builder).
   - No secrets in code (all via `env.*`).
   - CORS locked to `env.frontendUrl` (`backend/src/index.ts:20-28` unchanged).
   - `Bearer` enforced via `authenticate` on `/me` (T6).
   - No open redirect (`navigate(from ?? '/')` — D11, hardcoded `/` fallback).
   - No Google error leak (T3 wraps all Google calls in try/catch → generic `Authentication failed`).
   - `JWT_SECRET` length validated (≥32 chars) at boot (T1).

8. **Fill the integration record** in §7 with commit SHAs, `POST /api/auth/google` response sample, JWT decoded claims, bad-code curl output, lint/format/typecheck/test exit codes.

**Acceptance Criteria:**
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test -ws` all exit 0 (F02 pre-existing db.test.ts failures noted, not F05 regressions).
- [ ] `npm run build -w backend` + `-w frontend` produce `dist/`.
- [ ] `backend/.env.example` + `frontend/.env.example` complete.
- [ ] Error code vocabulary unchanged (6 F03 codes, no additions).
- [ ] No schema delta (schema.ts matches F02).
- [ ] All security mandates verified (no console.log, no raw SQL, no secrets, CORS locked, Bearer enforced, no open redirect, no Google error leak, JWT_SECRET length checked).
- [ ] §7 integration record filled.

**Dependencies:** T13 (smoke complete, artifacts captured).

---

## 7. Final F05 Acceptance Checklist

- [ ] **Google OAuth 2.0 flow (Authorization Code, PKCE) completes end to end.** GIS popup via `@react-oauth/google` `flow: 'auth-code'` (D1); backend exchanges code via `google-auth-library` (D5) + verifies ID token; PKCE handled internally by GIS. Captured in T13 step 5. (Acceptance bullet 1.)
- [ ] **`google_id`, `email`, `full_name`, `avatar_url` populated on first login; updated on subsequent logins.** `userService.upsertByGoogleId` (T4, D9) uses `.onConflictDoUpdate({target: users.googleId, set: {email, fullName, avatarUrl, updatedAt}})`. Verified via T13 step 4 (login) + a second login with changed Google profile data. (Acceptance bullet 2.)
- [ ] **JWT signed with `JWT_SECRET`, contains `sub`, `email`, `role`, `exp` claim.** `jwt.ts` (T2) signs with HS256 via `jose` (D3); claims `sub`/`email`/`role`/`iat`/`exp`/`iss`/`aud` per D4. Verified via T13 step 6 (jwt.io decode). (Acceptance bullet 3.)
- [ ] **Logout clears the token client-side.** `TopNav` "Sign out" (T12) calls `logout()` (T11, best-effort) → `useAuthStore.clear()` (clears `localStorage['slyk-auth']`) → `navigate('/login')`. Verified via T13 step 8. (Acceptance bullet 4.)
- [ ] **`authenticate` middleware rejects missing/expired tokens with 401.** T5; table-driven tests cover missing header, malformed scheme, expired token, tampered token, wrong issuer, wrong audience. (F07 acceptance preview — F05 ships the middleware.)
- [ ] **Frontend auth context exposes current user + role.** `useAuthStore` (T8) persists `{token, id, email, name, role, avatarUrl}` via Zustand `persist`. `TopNav` (T12) renders avatar/initials + role-aware UI. (F07 acceptance preview.)
- [ ] **`/api/auth` routes mounted before `notFound`.** `backend/src/index.ts` (T6) inserts `app.use('/api/auth', authRouter)` between `:46` and `:49`.
- [ ] **No new error codes.** F03's 6-code vocabulary unchanged. F05 uses `UNAUTHENTICATED` (401), `VALIDATION_FAILED` (400), `INTERNAL_ERROR` (500).
- [ ] **No schema delta.** `backend/src/db/schema.ts:8-22` unchanged from F02.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + tests pass (`npm run typecheck && npm test -ws` exit 0; F02 pre-existing `db.test.ts` failures noted as non-F05).
- [ ] `npm run build -w backend` + `-w frontend` produce `dist/`.
- [ ] Google Cloud Console OAuth client config documented (T13).
- [ ] Commits land on `main` as `SLYK-F05: msg` (single-line); rebase-and-merge only (no squash, no merge commits) per `git-guidelines.md`.
- [ ] `.gitignore` retains `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store` (no F05 change).
- [ ] Security mandates: no `console.log` in prod, no raw SQL, no secrets in code, CORS locked to `FRONTEND_URL`, `Bearer` enforced on `/me`, no open redirect (D11), no Google error leak (D7), `JWT_SECRET` ≥32 chars (T1).

**Integration record (fill during T14):**
- Feature commit SHAs: `________` (list all `SLYK-F05:` commits)
- `POST /api/auth/google` response sample (HTTP 200 body): `________`
- JWT decoded claims (from jwt.io): `________`
- Bad-code curl output (`POST /api/auth/google` with `{code: 'invalid'}`): `________`
- Missing-code curl output (`POST /api/auth/google` with `{}`): `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0` (F02 `db.test.ts` failures noted: ___ of ___)
- `npm run build -w backend` exit code + `dist/` produced: `________`
- `npm run build -w frontend` exit code + `dist/` produced: `________`
- Google Cloud Console OAuth Client ID configured: `________` (JS origins + `postmessage` redirect)

**Out-of-scope caveats (carried forward to F06/F07):**
- `ALLOWED_DOMAIN` enforcement + first-user `ADMIN` promotion → **F06**. F05 ships all users as `MEMBER`.
- Token revocation, refresh tokens, role-change session invalidation, multi-tab logout sync, HttpOnly cookie migration → **F07**. F05's JWT is stateless; logout is client-side only.
- The accepted XSS tradeoff of localStorage JWT storage (D2) is intentional for MVP velocity. F07 will evaluate HttpOnly cookie + refresh-token rotation.

---

## 8. Schema deltas owned by this feature

**None.** F05 owns no schema deltas. The `users` table (`backend/src/db/schema.ts:8-22`) is already complete from F02 with all columns F05 needs: `id` (uuid PK), `googleId` (text unique notNull), `email` (text unique notNull), `fullName` (text notNull), `avatarUrl` (text nullable), `role` (Role default `'MEMBER'` notNull), `createdAt`, `updatedAt`.

| Delta | Detail | Migration |
| --- | --- | --- |
| — | None — see F02 schema (`backend/src/db/schema.ts:8-22`) | — |
