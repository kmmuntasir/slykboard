# syntax=docker/dockerfile:1
#
# slykboard — BACKEND production image (single stage, runs via tsx).
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
#   - Node 24 per root package.json engines >= 24.
#   - NOT alpine: musl breaks pg-class native addons (e.g. node-postgres).
#
# Runtime: `tsx src/index.ts` (no tsc/dist step). tsx is a backend devDep,
# hoisted to /app/node_modules/.bin after `npm ci` (with devDeps) at /app.
# npx resolves it from the backend workdir via the node_modules/.bin PATH.
#
# Migration path: /app/backend/src/db/migrations — resolved by
# src/index.ts via import.meta.url under tsx (run from src/index.ts).

FROM node:24-bookworm-slim

# tini = proper PID 1 / signal forwarding to the graceful-shutdown handler.
# bookworm-slim does NOT ship tini; install as root before USER node.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests FIRST so source changes don't bust the install layer (BuildKit cache).
# Root lockfile + both workspace manifests are required for workspace validation.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node backend/package.json ./backend/
COPY --chown=node:node frontend/package.json ./frontend/

# Hand /app to the node user BEFORE npm ci (so its caches/logs are owned).
RUN chown -R node:node /app

USER node

# Full workspace tree WITH devDeps (typescript, tsx hoisted to /app/node_modules/.bin).
RUN npm ci

WORKDIR /app/backend

# Backend config + sources (includes src/index.ts and src/db/migrations).
COPY --chown=node:node backend/tsconfig.json ./
COPY --chown=node:node backend/drizzle.config.ts ./
COPY --chown=node:node backend/src ./src

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# tini forwards signals (SIGTERM) to node for graceful shutdown.
ENTRYPOINT ["tini", "--"]

# tsx runs TypeScript directly (no tsc/dist). npx finds the tsx bin in
# /app/node_modules/.bin via PATH lookup from the backend workdir.
CMD ["npx", "tsx", "src/index.ts"]
