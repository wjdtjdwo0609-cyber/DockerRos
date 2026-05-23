#!/usr/bin/env bash
# Serve the web viewer on http://localhost:8090. The actual server is
# serve.py so the same code can run from the Windows .bat launcher.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8090}"
exec python3 "$(dirname "$0")/serve.py" "$PORT"
