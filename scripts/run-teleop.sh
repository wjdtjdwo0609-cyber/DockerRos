#!/usr/bin/env bash
# Keyboard teleop for TurtleBot3. Run this after TurtleBot3.command.
source "$(dirname "$0")/_common.sh"

export TURTLEBOT3_MODEL="${TURTLEBOT3_MODEL:-burger}"

echo "[INFO] 이 터미널에 포커스 두고 키보드로 조작:"
echo "       w/x : 전진/후진, a/d : 좌/우 회전, s : 정지"
exec ros2 run turtlebot3_teleop teleop_keyboard
