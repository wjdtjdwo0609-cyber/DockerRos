#!/usr/bin/env bash
# Open a shell with the native ROS2 env + workspace overlay already sourced.
source "$(dirname "$0")/_common.sh"

echo "[INFO] Native ROS2 $ROS_DISTRO active."
echo "[INFO] ros2, colcon, rviz2, gazebo are on PATH."
echo "[INFO] 예: colcon build --packages-select hello_ros2"
exec "$SHELL" -i
