# syntax=docker/dockerfile:1
#
# slykboard — FRONTEND production image (multi-stage, nginx-served SPA).
#
# Build context = REPO ROOT (npm workspaces; same convention as the backend
# Dockerfile at repo root).
#   docker build -f frontend/Dockerfile -t slykboard-frontend .
#
# WHY context=root (NOT frontend/):
#   - npm workspaces monorepo; a single package-lock.json lives at repo root.
#   - frontend/package-lock.json does NOT exist, so `npm ci` MUST run at /app
#     (repo-root-equivalent) to resolve the workspace dependency tree. backend's
#     package.json is also required for workspace validation during install.
#
# Build-time Vite vars (Vite inlines VITE_* into the bundle at build; a per-env
# rebuild is required to change them — they are NOT runtime-configurable):
#   --build-arg VITE_API_BASE_URL=...        (REQUIRED — env.ts throws if absent)
#   --build-arg VITE_GOOGLE_CLIENT_ID=...    (REQUIRED — public OAuth client id)
#   --build-arg VITE_POLL_INTERVAL_SECONDS=30 (optional, default 30)

# ----------------------------------------------------------------------------
# Stage 1 — build (needs devDeps incl. typescript + vite)
# ----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build

WORKDIR /app

# Manifests FIRST so source changes don't bust the install layer (BuildKit cache).
# Frontend + backend manifests both required for npm workspaces validation.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

# Full workspace tree incl. devDeps (typescript/vite hoisted to /app/node_modules/.bin).
RUN npm ci

# tsconfig (extends ../tsconfig.base.json) + build config.
COPY tsconfig.base.json ./
COPY frontend/tsconfig.json ./frontend/
COPY frontend/vite.config.ts ./frontend/
COPY frontend/index.html ./frontend/

# Frontend sources.
COPY frontend/src ./frontend/src

# Build-time Vite env (baked into the bundle; client-exposed, no secrets).
ARG VITE_API_BASE_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_POLL_INTERVAL_SECONDS=30
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_POLL_INTERVAL_SECONDS=$VITE_POLL_INTERVAL_SECONDS

# tsc -b && vite build → /app/frontend/dist (outDir default dist, base /).
RUN npm run build -w frontend

# ----------------------------------------------------------------------------
# Stage 2 — serve (nginx:alpine static SPA)
# ----------------------------------------------------------------------------
FROM nginx:alpine AS serve

# Static assets only. API calls go to the separate backend host via the
# VITE_API_BASE_URL baked into the bundle (D2 / §9 — FE container is static-only).
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# nginx server config (SPA fallback + gzip + asset caching).
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
