#!/usr/bin/env bash
# Lightweight UR arm viewer: RViz + joint sliders (no Gazebo, no MoveIt).
# Use this to SEE the arm and manually move joints with sliders.
source "$(dirname "$0")/_common.sh"

ROBOT="${1:-ur5e}"
echo "[INFO] UR 팔 뷰어 ($ROBOT) — RViz + 관절 슬라이더"
echo "[INFO] 창 2개 뜸:"
echo "       1) RViz: 3D로 팔 표시"
echo "       2) joint_state_publisher_gui: 슬라이더 6개"
echo "[INFO] XQuartz로 전환 (Dock 아이콘) → 슬라이더 드래그하면 RViz에서 팔 움직임"
exec ros2 launch ur_description view_ur.launch.py ur_type:="$ROBOT"
