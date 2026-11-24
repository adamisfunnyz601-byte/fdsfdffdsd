#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-development}"
MODEL="${OLLAMA_MODEL:-tinyllama:1.1b-chat}"
export OLLAMA_MODEL="$MODEL"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
OLLAMA_URL="http://${OLLAMA_HOST}"

# Ollama is an optional sidecar for NEXUS AI features. Never make the web
# server wait for the daemon or a model download: autoscaling platforms have
# strict instance-start deadlines and must receive the HTTP listener quickly.
if command -v ollama >/dev/null 2>&1; then
  if ! curl --silent --fail --max-time 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
    echo "[NEXUS AI] Starting Ollama in the background..."
    ollama serve >/tmp/nexus-ollama.log 2>&1 </dev/null &
    echo "$!" >/tmp/nexus-ollama.pid
  fi

  # Preserve the previous automatic model setup, but do it independently of
  # the web process. A failed/slow Ollama download must never fail app startup.
  (
    READY=0
    for attempt in $(seq 1 30); do
      if curl --silent --fail --max-time 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
        READY=1
        break
      fi
      sleep 1
    done

    if [ "$READY" -ne 1 ]; then
      echo "[NEXUS AI] Ollama did not become ready; web server will continue without local AI."
      tail -n 30 /tmp/nexus-ollama.log 2>/dev/null || true
      exit 0
    fi

    if ! ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -Fxq "$MODEL"; then
      echo "[NEXUS AI] Downloading $MODEL in the background..."
      if ! ollama pull "$MODEL"; then
        echo "[NEXUS AI] Could not download $MODEL; web server remains available."
        tail -n 30 /tmp/nexus-ollama.log 2>/dev/null || true
        exit 0
      fi
    fi
    echo "[NEXUS AI] Model $MODEL is ready."
  ) >/tmp/nexus-ollama-bootstrap.log 2>&1 </dev/null &
else
  echo "[NEXUS AI] Ollama is not installed; starting NEXUS without local AI."
fi

# Start the HTTP server immediately. AI model initialization is deliberately
# detached so it cannot consume the platform's function/instance boot timeout.
if [ "$MODE" = "production" ]; then
  if [ ! -f dist/index.cjs ]; then
    echo "[NEXUS] Production build dist/index.cjs is missing. Run npm run build first."
    exit 1
  fi
  exec node ./dist/index.cjs
fi

exec npm run dev
