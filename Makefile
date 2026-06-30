# Slykboard — dev task runner.
# Run `make` (or `make help`) to list targets.
# Requires: Docker, Node 24 (see .nvmrc), npm.

.DEFAULT_GOAL := help
.PHONY: help bootstrap env env-force up down restart db-logs db-psql \
        install migrate migrate-push migrate-generate studio seed \
        dev dev-api dev-web build start \
        test test-api test-web lint typecheck format format-check \
        gate gate-typecheck gate-build gate-lint gate-prettier gate-test \
        health check-node clean

# --- Docker Postgres ----------------------------------------------------------

up: ## Start local Postgres container and wait until healthy
	docker compose up -d --wait

down: ## Stop the Postgres container (keeps volume)
	docker compose down

restart: ## Restart the Postgres container
	docker compose restart

db-logs: ## Tail Postgres container logs
	docker compose logs -f postgres

db-psql: ## Open psql shell inside the Postgres container
	docker compose exec postgres psql -U slyk -d slykboard

# --- Migrations / DB tools ----------------------------------------------------

migrate: ## Apply pending Drizzle migrations to the local DB
	cd backend && npx tsx src/db/migrate.ts

migrate-push: ## Push schema directly to DB (dev only — no migration file)
	npm run -w backend db:push

migrate-generate: ## Generate a new Drizzle migration from schema changes
	npm run -w backend db:generate

studio: ## Open Drizzle Studio (DB GUI)
	npm run -w backend db:studio

seed: ## Run the DB seed script
	npm run -w backend db:seed

# --- Dev / build --------------------------------------------------------------

install: ## Install all workspace dependencies
	npm install

dev: ## Run backend + frontend concurrently (API :3000, web :5173)
	npm run dev

dev-api: ## Run backend dev server only
	npm run dev:api

dev-web: ## Run frontend dev server only
	npm run dev:web

build: ## Type-check + build both packages
	npm run build

start: ## Run the built backend (after `make build`)
	npm run start -w backend

# --- Quality ------------------------------------------------------------------

test: ## Run all tests (backend + frontend)
	npm test

test-api: ## Run backend tests only
	npm run test -w backend

test-web: ## Run frontend tests only
	npm run test -w frontend

lint: ## Lint the whole repo
	npm run lint

typecheck: ## Type-check both packages (no emit)
	npm run typecheck

format: ## Format the whole repo with Prettier
	npm run format

format-check: ## Check formatting without writing
	npm run format:check

# --- Merge gate (F50) ---------------------------------------------------------
# The verifiable "independently shippable" claim for UI-redesign PRs (F31–F51).
# Every redesign PR must pass `make gate` GREEN before rebase-and-merge.
# Stages run in order; the first failure stops the gate.

gate: ## Run the full F50 merge gate (typecheck + build + lint + prettier + test)
	./scripts/merge-gate.sh all

gate-typecheck: ## Gate stage: tsc --noEmit (backend + frontend)
	./scripts/merge-gate.sh typecheck

gate-build: ## Gate stage: build both workspaces
	./scripts/merge-gate.sh build

gate-lint: ## Gate stage: eslint --max-warnings=0
	./scripts/merge-gate.sh lint

gate-prettier: ## Gate stage: prettier --check
	./scripts/merge-gate.sh prettier

gate-test: ## Gate stage: vitest run (backend + frontend)
	./scripts/merge-gate.sh test

# --- Misc ---------------------------------------------------------------------

health: ## Probe the backend health endpoint
	curl -fsS http://localhost:3000/api/health && echo

check-node: ## Verify Node version matches .nvmrc (>= 24)
	@node -p "process.versions.node" | awk '{ \
		split($$1, v, "."); \
		if (v[1] < 24) { \
			printf "\n\033[31mNode %s too old — need 24+ (see .nvmrc: nvm use)\033[0m\n\n", $$1; \
			exit 1; \
		} else { \
			printf "\n\033[32mNode %s OK\033[0m\n\n", $$1; \
		} \
	}'

clean: ## Remove node_modules, dist, and build artifacts
	rm -rf node_modules frontend/node_modules backend/node_modules \
	       frontend/dist backend/dist

# --- Bootstrap (fresh clone) --------------------------------------------------
# Gets a brand-new checkout to a runnable state: deps, env, DB, migrations.

env: ## Copy .env.example -> .env for each package (skips if .env exists)
	@if [ ! -f backend/.env ]; then \
	  awk -v j="$$(openssl rand -base64 48)" '/^JWT_SECRET=/{print "JWT_SECRET="j; next} {print}' \
	    backend/.env.example > backend/.env && \
	  echo "  created backend/.env (JWT_SECRET generated)"; \
	else echo "  backend/.env exists — skipping"; fi
	@if [ ! -f frontend/.env ]; then cp frontend/.env.example frontend/.env && \
	  echo "  created frontend/.env"; \
	else echo "  frontend/.env exists — skipping"; fi
	@echo "\n\033[33mNext: fill GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in backend/.env\nand VITE_GOOGLE_CLIENT_ID in frontend/.env, then \`make dev\`.\033[0m"

env-force: ## Add missing keys from .env.example into .env (preserves existing values)
	@touch backend/.env frontend/.env
	@awk -v j="$$(openssl rand -base64 48)" '\
		FILENAME==ARGV[1] { if ($$0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { k=$$0; sub(/=.*/, "", k); seen[k]=1 } print; next }\
		/^JWT_SECRET=/ { if (seen["JWT_SECRET"]) next; if (!h) { print ""; print "# Added by make env-force"; h=1 } print "JWT_SECRET="j; next }\
		/^[A-Za-z_][A-Za-z0-9_]*=/ { k=$$0; sub(/=.*/, "", k); if (seen[k]) next; if (!h) { print ""; print "# Added by make env-force"; h=1 } print }\
	' backend/.env backend/.env.example > backend/.env.tmp && mv backend/.env.tmp backend/.env
	@awk '\
		FILENAME==ARGV[1] { if ($$0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { k=$$0; sub(/=.*/, "", k); seen[k]=1 } print; next }\
		/^[A-Za-z_][A-Za-z0-9_]*=/ { k=$$0; sub(/=.*/, "", k); if (seen[k]) next; if (!h) { print ""; print "# Added by make env-force"; h=1 } print }\
	' frontend/.env frontend/.env.example > frontend/.env.tmp && mv frontend/.env.tmp frontend/.env
	@echo "  merged missing keys into backend/.env + frontend/.env (existing values preserved)"
	@echo "\n\033[33mIf JWT_SECRET was added, fill GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in backend/.env\nand VITE_GOOGLE_CLIENT_ID in frontend/.env, then \`make dev\`.\033[0m"

bootstrap: ## Fresh-clone bootstrap: node check -> install -> env -> DB -> migrate -> seed PA
	@echo "\n\033[1m[1/7] Node version\033[0m"
	@$(MAKE) --no-print-directory check-node
	@echo "\n\033[1m[2/7] Install dependencies\033[0m"
	npm install
	@echo "\n\033[1m[3/7] Environment files\033[0m"
	@$(MAKE) --no-print-directory env
	@echo "\n\033[1m[4/7] Start Postgres (docker)\033[0m"
	docker compose up -d --wait
	@echo "\n\033[1m[5/7] Apply migrations\033[0m"
	$(MAKE) --no-print-directory migrate
	@echo "\n\033[1m[6/7] Seed bootstrap Platform Admin\033[0m"
	cd backend && npx tsx src/db/bootstrap-admin.ts
	@echo "\n\033[1m[7/7] Done\033[0m"
	@echo "\n\033[32mSlykboard ready. Run \`make dev\` to start.\033[0m\n"

# --- Help ---------------------------------------------------------------------

help: ## Show this help (default target)
	@awk 'BEGIN { \
		FS = ":.*##"; \
		printf "\n\033[1mSlykboard — dev targets\033[0m\n"; \
		printf "\nUsage: make \033[36m<target>\033[0m\n\nTargets:\n"; \
	} \
	/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 } \
	END { printf "\n" }' $(MAKEFILE_LIST)
