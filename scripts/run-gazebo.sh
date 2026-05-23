#!/usr/bin/env bash
# Launch Gazebo Classic 11 with ROS2 bridge.
# Usage:
#   ./scripts/run-gazebo.sh                 # empty world
#   ./scripts/run-gazebo.sh path/to.world   # custom world
source "$(dirname "$0")/_common.sh"

WORLD="${1:-}"
echo "[INFO] Gazebo 실행. XQuartz 앱으로 전환해서 3D 창 확인."
if [ -n "$WORLD" ]; then
  exec ros2 launch gazebo_ros gazebo.launch.py world:="$WORLD"
else
  exec ros2 launch gazebo_ros gazebo.launch.py
fi
