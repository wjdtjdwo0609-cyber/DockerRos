#!/usr/bin/env bash
# Launch RViz2 native.
source "$(dirname "$0")/_common.sh"

echo "[INFO] RViz2 실행. XQuartz 앱으로 전환해서 창 확인."
exec rviz2 "$@"
