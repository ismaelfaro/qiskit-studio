#!/usr/bin/env bash
# Copyright contributors to the Qiskit Studio project
# SPDX-License-Identifier: Apache-2.0
#
# Run the whole Qiskit Studio stack locally (no Docker) in a single command:
#   - chat-agent     (fastapi)  http://127.0.0.1:8000/chat
#   - codegen-agent  (fastapi)  http://127.0.0.1:8001/chat
#   - coderun-agent  (fastapi)  http://127.0.0.1:8002/run
#   - frontend       (next.js)  http://127.0.0.1:3000
#
# All four run as child processes of this script. Press Ctrl+C once to stop them
# all. Logs are prefixed per-service and streamed to this terminal.
#
# On startup the script frees the four ports first, so re-running it cleanly
# replaces any previous (or orphaned) stack instead of failing with
# "address already in use".
#
# Prerequisites:
#   * uv     (https://docs.astral.sh/uv/) for the Python agents
#   * node + pnpm for the frontend
#   * An OpenAI-compatible LLM endpoint (e.g. local Ollama serving granite3.3:8b)
#
# Note: this does NOT start the vector DB (milvus) or knowledge-mcp. For the full
# RAG stack use `docker compose up --build` from the repo root instead.
#
# Compatible with bash 3.2 (the default /bin/bash on macOS): avoids `wait -n`.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/api"

# Configurable ports.
CHAT_PORT="${CHAT_PORT:-8000}"
CODEGEN_PORT="${CODEGEN_PORT:-8001}"
CODERUN_PORT="${CODERUN_PORT:-8002}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# coderun-agent pulls jax/jaxlib (via ffsim/pyscf/sqd), which no longer ships
# x86_64 macOS wheels. On Intel Macs the local uv install fails, so:
#   SKIP_CODERUN=1    -> don't start coderun at all (run it elsewhere / Docker)
#   CODERUN_DOCKER=1  -> start coderun via `docker compose` instead of local uv
# Default: auto-skip local coderun on Intel macOS (and hint at the Docker path).
SKIP_CODERUN="${SKIP_CODERUN:-0}"
CODERUN_DOCKER="${CODERUN_DOCKER:-0}"

# LLM model for the chat + codegen agents (passed as env to the FastAPI apps).
# Any OpenRouter slug; `:free` = no cost.
LLM_MODEL="${LLM_MODEL:-nex-agi/nex-n2-pro:free}"
if [[ "$SKIP_CODERUN" != "1" && "$CODERUN_DOCKER" != "1" \
      && "$(uname -s)" == "Darwin" && "$(uname -m)" == "x86_64" ]]; then
  echo "Detected Intel macOS: jax/jaxlib has no x86_64 wheel, so coderun-agent"
  echo "cannot run locally."
  if command -v docker >/dev/null 2>&1; then
    # The coderun container IS the qiskit simulator (qiskit + qiskit-aer); the
    # stack needs it to evaluate generated code, so run it in Docker.
    echo "Docker found: auto-setting CODERUN_DOCKER=1 (qiskit simulator container)."
    CODERUN_DOCKER=1
  else
    echo "Docker not found: auto-setting SKIP_CODERUN=1 (code execution disabled)."
    SKIP_CODERUN=1
  fi
  echo
fi

ALL_PORTS=("$CHAT_PORT" "$CODEGEN_PORT" "$FRONTEND_PORT")
[[ "$SKIP_CODERUN" != "1" ]] && ALL_PORTS+=("$CODERUN_PORT")

PIDS=()
SHUTTING_DOWN=0

# Color prefixes for readable interleaved logs.
c_reset='\033[0m'; c_chat='\033[36m'; c_codegen='\033[35m'; c_coderun='\033[33m'; c_front='\033[32m'

# Kill whatever is listening on a TCP port (previous run / orphans).
kill_port() {
  local port="$1" pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "  freeing port $port (killing: $(echo "$pids" | tr '\n' ' '))"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    # shellcheck disable=SC2086
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  fi
}

# Recursively kill a process and all of its descendants (pgrep -P walks the tree).
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  [[ "$SHUTTING_DOWN" -eq 1 ]] && return
  SHUTTING_DOWN=1
  echo
  echo "Shutting down services..."
  for pid in "${PIDS[@]:-}"; do
    [[ -n "$pid" ]] && kill_tree "$pid"
  done
  # Killing `docker compose up` detaches but leaves the container running; stop it.
  if [[ "$CODERUN_DOCKER" == "1" ]]; then
    ( cd "$ROOT_DIR" && docker compose stop coderun-agent >/dev/null 2>&1 || true )
  fi
  # Belt and suspenders: reclaim the ports in case a grandchild outlived its parent.
  for port in "${ALL_PORTS[@]}"; do
    kill_port "$port" >/dev/null 2>&1 || true
  done
  echo "All services stopped."
}
trap cleanup INT TERM EXIT

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' not found in PATH. $2"; exit 1; }
}
require uv "Install from https://docs.astral.sh/uv/"
require pnpm "Install from https://pnpm.io/installation"
require lsof "Part of macOS/Linux base; needed to free stale ports"

# Each maestro agent needs an .env; seed it from the template if missing.
for agent in chat-agent codegen-agent; do
  if [[ ! -f "$API_DIR/$agent/.env" ]]; then
    echo "Seeding $agent/.env from api/.env.template"
    cp "$API_DIR/.env.template" "$API_DIR/$agent/.env"
  fi
done

# Frontend env (NEXT_PUBLIC_* point the browser at the local agent ports).
if [[ ! -f "$ROOT_DIR/.env.local" && -f "$ROOT_DIR/.env.local.template" ]]; then
  echo "Seeding .env.local from .env.local.template"
  cp "$ROOT_DIR/.env.local.template" "$ROOT_DIR/.env.local"
fi

# Install frontend deps on first run.
if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Installing frontend dependencies (pnpm install)..."
  (cd "$ROOT_DIR" && pnpm install)
fi

# Free any ports held by a previous (or orphaned) run before starting.
echo "Reclaiming ports from any previous run..."
for port in "${ALL_PORTS[@]}"; do
  kill_port "$port"
done

# run <color> <label> <dir> <command...>
run() {
  local color="$1" label="$2" dir="$3"; shift 3
  ( cd "$dir" && exec "$@" 2>&1 | while IFS= read -r line; do
      printf "${color}[%s]${c_reset} %s\n" "$label" "$line"
    done ) &
  PIDS+=($!)
}

echo "Starting Qiskit Studio stack..."
echo "  chat-agent     -> http://127.0.0.1:$CHAT_PORT/chat"
echo "  codegen-agent  -> http://127.0.0.1:$CODEGEN_PORT/chat"
if [[ "$SKIP_CODERUN" == "1" ]]; then
  echo "  coderun-agent  -> SKIPPED (set CODERUN_DOCKER=1 to run it in Docker)"
elif [[ "$CODERUN_DOCKER" == "1" ]]; then
  echo "  coderun-agent  -> http://127.0.0.1:$CODERUN_PORT/run  (Docker)"
else
  echo "  coderun-agent  -> http://127.0.0.1:$CODERUN_PORT/run"
fi
echo "  frontend       -> http://127.0.0.1:$FRONTEND_PORT"
echo

# Agents are plain FastAPI apps that call OpenRouter directly (no Maestro). They
# read OPENAI_* / LLM_MODEL from their .env (via python-dotenv); AGENT_MODE and
# LLM_MODEL are also passed explicitly here so dev.sh's LLM_MODEL wins.
run "$c_chat"    "chat"    "$API_DIR/chat-agent" \
  env AGENT_MODE=chat LLM_MODEL="$LLM_MODEL" uv run uvicorn agent:app --host 127.0.0.1 --port "$CHAT_PORT"
run "$c_codegen" "codegen" "$API_DIR/codegen-agent" \
  env AGENT_MODE=codegen LLM_MODEL="$LLM_MODEL" uv run uvicorn agent:app --host 127.0.0.1 --port "$CODEGEN_PORT"
if [[ "$CODERUN_DOCKER" == "1" ]]; then
  require docker "Install Docker (or Colima) to run coderun-agent in a container"
  run "$c_coderun" "coderun" "$ROOT_DIR" \
    env CODERUN_PORT="$CODERUN_PORT" docker compose up --build coderun-agent
elif [[ "$SKIP_CODERUN" != "1" ]]; then
  run "$c_coderun" "coderun" "$API_DIR/coderun-agent" uv run python agent.py --port "$CODERUN_PORT"
fi
# Turbopack (next dev --turbo) can speed dev compiles, but on Next 14.2 it errors
# on this project's components — left opt-in via NEXT_TURBO=1.
NEXT_TURBO="${NEXT_TURBO:-0}"
if [[ "$NEXT_TURBO" == "1" ]]; then
  run "$c_front" "front" "$ROOT_DIR" pnpm exec next dev --turbo --port "$FRONTEND_PORT"
else
  run "$c_front" "front" "$ROOT_DIR" pnpm run dev --port "$FRONTEND_PORT"
fi

# Keep running until the user hits Ctrl+C (the trap then tears everything down).
# We deliberately do NOT exit when a single service dies: a crashed agent should
# leave the others (and its log) up for inspection, and tearing down mid-startup
# would race uv's lazy spawn of the server process and leak ports.
echo "Stack running. Press Ctrl+C to stop everything."
set +e
wait
