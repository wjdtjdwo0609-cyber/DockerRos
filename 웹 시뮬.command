#!/usr/bin/env bash
cd "$(dirname "$0")"

# open browser after short delay so server is ready
(sleep 1.5 && open "http://localhost:8090") &

./web/serve.sh
