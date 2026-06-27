#!/usr/bin/env bash
# F50 — Merge gate for the UI-redesign track (F31–F51).
#
# "Independently shippable" must be a verifiable claim. Every redesign PR must
# pass this gate GREEN before merge (rebase-and-merge is the repo policy).
#
# Gate stages (each must pass; first failure stops the run):
#   1. typecheck   — tsc --noEmit, backend + frontend
#   2. build       — tsc -b && vite build (FE), tsc -p (BE)
#   3. lint        — eslint, --max-warnings=0 (zero warnings, zero errors)
#   4. prettier    — prettier --check on both src trees
#   5. test        — vitest run, backend + frontend
#
# Usage:
#   ./scripts/merge-gate.sh          # run all stages
#   ./scripts/merge-gate.sh lint     # run a single stage
#
# Stages can also be run via make: `make gate`, `make gate-lint`, etc.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# color helpers (disabled if not a TTY → CI-friendly)
if [ -t 1 ]; then
    GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
    GREEN=''; RED=''; YELLOW=''; BOLD=''; RESET=''
fi

STAGE="${1:-all}"
PASS=0; FAIL=0

run_stage() {
    local name="$1"; shift
    printf "\n${BOLD}=== %s ===${RESET}\n" "$name"
    if "$@"; then
        printf "${GREEN}[%s] PASS${RESET}\n" "$name"
        PASS=$((PASS + 1))
    else
        printf "${RED}[%s] FAIL${RESET}\n" "$name"
        FAIL=$((FAIL + 1))
        return 1
    fi
}

stage_typecheck() {
    npm run typecheck -w backend
    npm run typecheck -w frontend
}

stage_build() {
    npm run build -w backend
    npm run build -w frontend
}

stage_lint() {
    # --max-warnings=0 makes any warning (e.g. react-hooks lint) fail the gate.
    npx eslint frontend/src backend/src --max-warnings=0
}

stage_prettier() {
    npx prettier --check "frontend/src/**/*.{ts,tsx}" "backend/src/**/*.ts"
}

stage_test() {
    npm run test -w backend
    npm run test -w frontend
}

ALL_STAGES=(typecheck build lint prettier test)

if [ "$STAGE" = "all" ]; then
    printf "${BOLD}F50 merge gate — running all stages${RESET}\n"
    for s in "${ALL_STAGES[@]}"; do
        if ! run_stage "$s" "stage_$s"; then
            printf "\n${RED}Gate FAILED at stage '%s' — stopping.${RESET}\n" "$s"
            exit 1
        fi
    done
    printf "\n${GREEN}${BOLD}=== GATE GREEN (%d/%d stages passed) ===${RESET}\n" "$PASS" "${#ALL_STAGES[@]}"
    exit 0
else
    # single stage
    if ! declare -F "stage_$STAGE" >/dev/null 2>&1; then
        printf "${RED}Unknown stage '%s'. Valid: %s${RESET}\n" "$STAGE" "${ALL_STAGES[*]}"
        exit 2
    fi
    run_stage "$STAGE" "stage_$STAGE"
    exit $?
fi
