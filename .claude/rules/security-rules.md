# Security Rules

## Sacred

- **Never commit secrets.** Google OAuth client IDs/secrets, JWT signing keys — all via environment variables (`backend/.env`, `frontend/.env`, both gitignored).
- **Never log secrets, JWTs, credentials, PII, or full request/response payloads.** Mask identifiers (`userId=42`).
- **Never bypass pre-commit hooks** (`--no-verify`) — fix the issue.

## Authentication (Google OAuth 2.0 + App JWT)

- The auth-code exchange happens SERVER-SIDE only (`services/googleOAuth.ts` via `config/googleClient.ts` / `google-auth-library`) — never trust the client to say who they are.
- Validate the exchanged credentials' audience equals the configured `GOOGLE_CLIENT_ID`.
- If `ALLOWED_DOMAIN` is set, reject identities whose email domain doesn't match.
- Issue the app JWT with `jose` + `JWT_SECRET` (HS256) via `utils/jwt.ts`, carrying claims `{ sub, email, pa, ver }`. TTL from `JWT_TTL` (default `'8h'`).
- `middleware/authenticate` verifies the Bearer JWT on every protected endpoint and attaches the user identity to the request. Expired/invalid tokens → `401 UNAUTHENTICATED`.
- Logout invalidates by bumping the token version claim (`ver`, `tokenVersion` service) — no token blacklist.

## Authorization (two-tier — the core of this app)

- Platform admin flag rides in the JWT as `pa` (from `users.isPlatformAdmin`), but role changes require token re-issue; middleware gates platform-admin routes via `requirePlatformAdmin`.
- Per-project RBAC is enforced against the `projectMembers` table by the chain `authenticate` → `resolveProject` → `requireProjectMember` / `requireProjectAdmin` (roles: `PROJECT_ADMIN | MEMBER`).
- Permission decisions are centralized in `services/accessControl.ts` — route-level gating alone is NOT sufficient; the service layer re-checks before mutating or reading scoped data.
- Hiding UI from non-members (route guards, no links rendered) is convenience only — backend enforcement is the boundary.
- Cross-project access attempts → `403 FORBIDDEN`.

## Input Validation & XSS

- Zod validation at every route edge (co-located `*.schema.ts` + `validateRequest`). Reject malformed input with `400 VALIDATION_FAILED`. Never echo raw input back.
- Rich text (ticket descriptions, comments) ALWAYS passes through `utils/sanitizeHtml.ts` (isomorphic-dompurify): strip event handlers/scripts, reject `javascript:` / `data:` URIs, allow http(s) images only, keep the sanitized subset.
- React escapes by default — avoid `dangerouslySetInnerHTML` outside the sanctioned sanitizer-rendered fields.

## SQL Injection

- Drizzle query builder / parameterized statements only. NEVER string-concatenate user input into SQL.

## CORS

- Allowed origins come from `FRONTEND_URL` only (comma-separated list), credentials enabled, never a wildcard.
- Explicit methods `[GET, POST, PUT, PATCH, DELETE]`; headers limited to `Content-Type, Authorization`; set a preflight `maxAge`.

## Headers & Transport

- `helmet` enabled on the Express app.
- Security headers are also reviewed at the reverse proxy — `nginx.conf` ships `X-Frame-Options` etc.; verify at deploy.
- Recommended at the proxy tier: `Strict-Transport-Security` (HSTS), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.

## Tokens in the Browser

- The app JWT lives in localStorage — a documented tradeoff, mitigated by the 8h TTL, token-version revocation, and cross-tab logout sync (storage events, `CrossTabLogoutSync`).
- Never place tokens in URLs, query strings, or logs.

## Board & Timer Integrity

- Position/reorder math for board moves is validated server-side — never trust client-supplied positions blindly.
- Elapsed-time display is cosmetic; durations persist from the server clock into `timeEntries`. Client clock values are advisory only.

## File / URL Inputs

- CKEditor image sources and uploads are restricted to http(s) origins — reject everything else.

## Dependency Hygiene

- Dependabot enabled; `high`/`critical` CVEs for runtime deps block merge.
- No new dependency without license review + CVE scan.

## Secrets Management

- Local dev: `.env` (gitignored) + dotenv. Real secrets never committed.
- CI (when added): GitHub Actions secrets, masked in logs.
- Production: env vars on the host (docker-compose/compose env or `.env` in the deploy dir, never in git). `GOOGLE_CLIENT_SECRET` and `JWT_SECRET` are the crown jewels.

## Persistence

- Postgres runs in docker-compose volumes; the app never assumes local file storage of data.
- Never commit DB dumps or seeds containing real user data. Backups are out of scope of app code.

## What Not to Do

- Don't return other users' or other projects' data unguarded — always scope queries by membership.
- Don't log `Authorization` headers, request/response bodies, JWTs, or DB contents.
- Don't store passwords — this app uses Google OAuth only, no password auth.
- Don't expose internal stack traces via API responses.
- Don't grant platform admin without the persisted `isPlatformAdmin` flag (`bootstrap-admin.ts` is the only bootstrap path).
- Don't weaken the sanitizer allowlist to make tests pass.
- Don't add a second unsanitized render path for rich text.
