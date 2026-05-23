#!/usr/bin/env bash
# Launch rosbridge_server — bridges ROS2 ↔ WebSocket (ws://localhost:9090).
# Pair with the web viewer's "ROS2 연결" button.
source "$(dirname "$0")/_common.sh"

echo "[INFO] rosbridge_server 시작 — ws://localhost:9090"
echo "[INFO] 브라우저에서 [ROS2 연결] 버튼 누르면 /joint_states 실시간 동기화"
exec ros2 launch rosbridge_server rosbridge_websocket_launch.xml
