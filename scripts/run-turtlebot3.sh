#!/usr/bin/env bash
# Launch TurtleBot3 in a Gazebo world.
# Usage:
#   ./scripts/run-turtlebot3.sh           # empty_world (default)
#   ./scripts/run-turtlebot3.sh world     # turtlebot3_world (cylinders & box)
#   ./scripts/run-turtlebot3.sh house     # turtlebot3_house (apartment)
source "$(dirname "$0")/_common.sh"

export TURTLEBOT3_MODEL="${TURTLEBOT3_MODEL:-burger}"   # burger / waffle / waffle_pi

case "${1:-world}" in
  empty)  LAUNCH=empty_world.launch.py ;;
  world)  LAUNCH=turtlebot3_world.launch.py ;;
  house)  LAUNCH=turtlebot3_house.launch.py ;;
  *)      LAUNCH="$1" ;;
esac

echo "[INFO] TurtleBot3 '$TURTLEBOT3_MODEL' in $LAUNCH"
echo "[INFO] 조종하려면 새 터미널에서 ROS셸.command 열고 실행:"
echo "       ros2 run turtlebot3_teleop teleop_keyboard"
echo "[INFO] XQuartz 앱으로 전환해서 3D 창 확인 (Dock 아이콘 클릭)"
exec ros2 launch turtlebot3_gazebo "$LAUNCH"
