# syntax=docker/dockerfile:1
#
# slykboard — BACKEND production image (multi-stage).
#
# Build context = REPO ROOT.
#   docker build -f Dockerfile -t slykboard-backend .
#
# WHY context=root:
#   - npm workspaces monorepo; a single package-lock.json lives at repo root.
#   - backend/package-lock.json does NOT exist, so `npm ci` MUST run at /app
#     (repo-root-equivalent) to resolve the workspace dependency tree.
#
# Base image: node:24-bookworm-slim
#   - Node 24 per .nvmrc (root package.json engines >= 24).
#   - NOT alpine: musl breaks pg-class native addons (e.g. node-postgres).
#
# ESM backend ("type":"module"): `node dist/index.js` runs with no flags.
#
# In-image migration paths (downstream task T4 — migrate-on-boot):
#   - /app/backend/dist/db/migrations  — runtime path resolved by compiled
#     dist/db/migrate.js via import.meta.url (working default; T4 runs
#     `node backend/dist/db/migrate.js` from /app).
#   - /app/backend/src/db/migrations   — plan-acceptance path; present if T4
#     resolves against source instead of compiled output.

# ----------------------------------------------------------------------------
# Stage 1 — build (needs devDeps incl. typescript for the tsc compile)
# ----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build

WORKDIR /app

# Manifests FIRST so source changes don't bust the install layer (BuildKit cache).
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
# Frontend manifest is required for workspace validation even though unused at runtime.
COPY frontend/package.json ./frontend/

# Full workspace tree incl. devDeps (typescript is hoisted to /app/node_modules/.bin).
RUN npm ci

# backend/tsconfig.json extends ../tsconfig.base.json → copy the base to /app.
COPY tsconfig.base.json ./
COPY backend/tsconfig.json ./backend/

# Backend sources.
COPY backend/src ./backend/src

WORKDIR /app/backend

# tsc → /app/backend/dist (outDir from backend/tsconfig.json).
RUN npm run build

# tsc does NOT copy non-TS assets (.sql). Copy migrations next to the compiled
# dist/db/migrate.js, which resolves them at runtime via import.meta.url.
RUN cp -r src/db/migrations dist/db/migrations

# ----------------------------------------------------------------------------
# Stage 2 — runner (runtime image)
# ----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3000

# tini = proper PID 1 / signal forwarding to the graceful-shutdown handler.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests for prod-only install.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Prod deps only, hoisted workspace tree → /app/node_modules (readable by node user).
RUN npm ci --omit=dev

# Compiled app (includes dist/db/migrations from the cp in stage 1).
COPY --from=build /app/backend/dist ./backend/dist

# Plan-acceptance migration path: present if T4 resolves against source.
COPY --from=build /app/backend/src/db/migrations ./backend/src/db/migrations

# The `node` user (uid 1000) exists in the image; hand over /app.
RUN chown -R node:node /app

USER node

WORKDIR /app

EXPOSE 3000

# tini forwards signals (SIGTERM) to node for graceful shutdown.
ENTRYPOINT ["tini", "--"]

# Compiled ESM entry — NOT src/index.js.
CMD ["node", "backend/dist/index.js"]
