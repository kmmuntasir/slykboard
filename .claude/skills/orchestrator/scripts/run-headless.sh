#!/usr/bin/env bash
# run-headless.sh — unified headless dispatch for the orchestrator skill.
#
# Usage:
#   run-headless.sh <role> <schema-file> [session-id]  < prompt.txt > out.json
#   RESUME=1 run-headless.sh <role> <schema-file> <session-id>  < followup.txt > out.json
#
# <role>          : main-analyst | coder | sub-orchestrator  (selects roles/<role>.md)
# <schema-file>   : JSON Schema file (inlined into --json-schema)
# [session-id]    : optional UUID; enables deterministic --resume later
# Prompt is read from stdin; result JSON written to stdout; diagnostics to stderr.
set -euo pipefail

ROLE="${1:?usage: run-headless.sh <role> <schema-file> [session-id]}"
SCHEMA_FILE="${2:?schema file required}"
SESSION_ID="${3:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLE_FILE="${HERE}/../roles/${ROLE}.md"

[[ -f "$ROLE_FILE" ]]   || { echo "missing role file: $ROLE_FILE" >&2; exit 2; }
[[ -f "$SCHEMA_FILE" ]] || { echo "missing schema file: $SCHEMA_FILE" >&2; exit 2; }

SCHEMA="$(cat "$SCHEMA_FILE")"

ARGS=(
  -p
  --output-format json
  --json-schema "${SCHEMA}"
  --append-system-prompt-file "${ROLE_FILE}"
  --dangerously-skip-permissions
)

if [[ "${RESUME:-0}" == "1" ]]; then
  [[ -n "${SESSION_ID}" ]] || { echo "RESUME=1 requires a session-id" >&2; exit 2; }
  ARGS+=(--resume "${SESSION_ID}")
elif [[ -n "${SESSION_ID}" ]]; then
  ARGS+=(--session-id "${SESSION_ID}")
fi

# Depth accounting: each headless layer sees parent_depth + 1.
export ORCHESTRATOR_DEPTH=$(( ${ORCHESTRATOR_DEPTH:-0} + 1 ))
export ORCHESTRATOR_MAX_DEPTH="${ORCHESTRATOR_MAX_DEPTH:-2}"
export ORCHESTRATOR_FLAT="${ORCHESTRATOR_FLAT:-0}"

exec claude "${ARGS[@]}"
