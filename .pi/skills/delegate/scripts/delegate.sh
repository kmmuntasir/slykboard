#!/usr/bin/env bash
# delegate.sh — spawn isolated headless `pi -p` subprocesses to run a role skill.
# Each subprocess is its own context window (ephemeral, --no-session), loads the
# role via `/skill:<role> <prompt>`, runs to completion, and prints its final
# answer to stdout. This is pi's subagent-substitute (pi has no native subagents).
#
# Usage:
#   delegate.sh <role> "<prompt>"
#   echo "<prompt>" | delegate.sh <role> --stdin
#   delegate.sh --parallel <role> "<prompt>" [ <role> "<prompt>" ... ]
#
# Env:
#   DELEGATE_TOOLS    comma-list of built-in tools for the subprocess (overrides role default)
#   DELEGATE_MODEL    model pattern e.g. sonnet:high, haiku
#   DELEGATE_THINKING off|minimal|low|medium|high|xhigh
#   DELEGATE_TIMEOUT  per-subprocess seconds (default 600)
#   DELEGATE_QUIET    1 = suppress [delegate] progress lines on stderr
set -euo pipefail

TIMEOUT="${DELEGATE_TIMEOUT:-600}"
QUIET="${DELEGATE_QUIET:-0}"

# Resolve the pi binary. Prefer a node_modules-local install, else PATH.
PI_BIN="pi"
if [ -x "./node_modules/.bin/pi" ]; then
  PI_BIN="./node_modules/.bin/pi"
elif command -v pi >/dev/null 2>&1; then
  PI_BIN="$(command -v pi)"
else
  echo "[delegate] ERROR: 'pi' not found in PATH or ./node_modules/.bin" >&2
  exit 127
fi

# Default tool allowlist per role (built-ins: read,bash,edit,write,grep,find,ls)
default_tools_for() {
  case "$1" in
    analyst)    echo "read,grep,find,ls" ;;
    committer)  echo "bash,read" ;;
    *)          echo "" ;;
  esac
}

log() { [ "$QUIET" = "1" ] || echo "[delegate] $*" >&2; }

# Build the pi flags for a role, returning the argv on stdout (one token per line).
build_flags() {
  local role="$1"
  local tools
  if [ -n "${DELEGATE_TOOLS:-}" ]; then
    tools="$DELEGATE_TOOLS"
  else
    tools="$(default_tools_for "$role")"
  fi

  printf -- '--no-session\n'
  printf -- '--approve\n'
  if [ -n "$tools" ]; then
    printf -- '--tools\n%s\n' "$tools"
  fi
  if [ -n "${DELEGATE_MODEL:-}" ]; then
    printf -- '--model\n%s\n' "$DELEGATE_MODEL"
  fi
  if [ -n "${DELEGATE_THINKING:-}" ]; then
    printf -- '--thinking\n%s\n' "$DELEGATE_THINKING"
  fi
}

# Run one isolated delegation: role + prompt → final answer on stdout.
run_one() {
  local role="$1"
  local prompt="$2"

  if [ -z "$prompt" ]; then
    echo "[delegate] ERROR: empty prompt for role '$role'" >&2
    return 2
  fi

  # Read flags into an array.
  local -a flags=()
  while IFS= read -r line; do
    flags+=("$line")
  done < <(build_flags "$role")

  log "role=$role tools=${DELEGATE_TOOLS:-$(default_tools_for "$role")} timeout=${TIMEOUT}s"

  # Invoke /skill:<role> <prompt> in a headless, isolated, ephemeral subprocess.
  # `timeout` kills a stuck subprocess so the coordinator is never blocked forever.
  if ! timeout "${TIMEOUT}" "$PI_BIN" "${flags[@]}" -p "/skill:${role} ${prompt}" 2>&1; then
    local rc=$?
    echo "[delegate] subprocess for role '$role' exited $rc" >&2
    return "$rc"
  fi
}

# --- argument parsing -------------------------------------------------------

if [ "${1:-}" = "--parallel" ]; then
  shift
  if [ $# -eq 0 ]; then
    echo "[delegate] ERROR: --parallel needs role/prompt pairs" >&2
    exit 2
  fi
  if [ $(( $# % 2 )) -ne 0 ]; then
    echo "[delegate] ERROR: --parallel args must be <role> \"<prompt>\" pairs" >&2
    exit 2
  fi

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  pids=()
  i=0
  while [ $# -gt 0 ]; do
    role="$1"; prompt="$2"; shift 2
    out="$tmpdir/$i.out"; err="$tmpdir/$i.err"
    DELEGATE_QUIET="${DELEGATE_QUIET:-1}" \
      run_one "$role" "$prompt" >"$out" 2>"$err" &
    pids+=($! "$role" "$out" "$err")
    i=$((i+1))
  done

  rc=0
  # Wait for all, collect results in input order.
  n=$(( ${#pids[@]} / 4 ))
  for (( j=0; j<n; j++ )); do
    off=$(( j*4 ))
    pid="${pids[$off]}"
    wait "$pid" || rc=$?
  done

  for (( j=0; j<n; j++ )); do
    off=$(( j*4 ))
    role="${pids[$((off+1))]}"
    out="${pids[$((off+2))]}"
    err="${pids[$((off+3))]}"
    echo "===== [$j] $role ====="
    cat "$out" || true
    [ -s "$err" ] && cat "$err" >&2 || true
  done
  exit "$rc"
fi

# Single mode.
if [ $# -lt 1 ]; then
  cat >&2 <<'EOF'
Usage:
  delegate.sh <role> "<prompt>"
  echo "<prompt>" | delegate.sh <role> --stdin
  delegate.sh --parallel <role> "<prompt>" [ <role> "<prompt>" ... ]
EOF
  exit 2
fi

role="$1"; shift
if [ "${1:-}" = "--stdin" ]; then
  prompt="$(cat)"
else
  prompt="${*:-}"
fi

run_one "$role" "$prompt"
