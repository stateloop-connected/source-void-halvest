#!/usr/bin/env bash
# Start or stop a local dev server in the background (pid in /tmp/opencode/vh-server.pid).
set -euo pipefail
cd "$(dirname "$0")"
PIDFILE=/tmp/opencode/vh-server.pid
case "${1:-start}" in
  stop)
    if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; fi
    ;;
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then kill "$(cat "$PIDFILE")"; sleep 1; fi
    PORT="${PORT:-2567}" EXTRA_ORIGINS="${EXTRA_ORIGINS:-http://localhost:8137}" setsid nohup node ${NODE_ARGS:-} src/index.js > /tmp/opencode/vh-server.log 2>&1 &
    echo $! > "$PIDFILE"
    sleep 3
    curl -fsS "localhost:${PORT:-2567}/__healthcheck" && echo " (pid $(cat "$PIDFILE"))"
    ;;
esac
