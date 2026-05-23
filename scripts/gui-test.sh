#!/usr/bin/env bash
# GUI sanity check: opens xeyes (basic X11 window). If this doesn't show, XQuartz is the problem.
source "$(dirname "$0")/_common.sh"

echo "[INFO] xeyes 창이 XQuartz 안에 떠야 합니다."
echo "[INFO] Dock에서 XQuartz 아이콘을 클릭하거나 Cmd+Tab으로 전환하세요."
echo "[INFO] 종료: Ctrl+C 또는 xeyes 창 닫기"
exec /opt/X11/bin/xeyes
