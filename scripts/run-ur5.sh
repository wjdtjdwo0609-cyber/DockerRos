#!/usr/bin/env bash
# Launch UR5e arm in Gazebo (new Fortress, via ros-gz) with MoveIt2 planning.
# Usage:
#   ./scripts/run-ur5.sh            # UR5e (default)
#   ./scripts/run-ur5.sh ur10e      # UR10e
#   ./scripts/run-ur5.sh ur3e       # UR3e (smaller)
source "$(dirname "$0")/_common.sh"

ROBOT="${1:-ur5e}"

echo "[INFO] $ROBOT (6축 매니퓰레이터) in Gazebo Fortress + MoveIt2"
echo "[INFO] 창 2개 뜸: Gazebo(시뮬) + RViz(MoveIt 계획)"
echo "[INFO] XQuartz 앱으로 전환 (Dock 클릭) 해서 창 확인"
echo "[INFO] RViz에서 녹색 공 드래그 → Plan & Execute 누르면 팔 움직임"
exec ros2 launch ur_simulation_gz ur_sim_moveit.launch.py ur_type:="$ROBOT"
