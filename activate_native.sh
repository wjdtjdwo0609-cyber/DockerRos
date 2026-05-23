#!/usr/bin/env bash
# Activate the native macOS RoboStack ROS2 Humble env.
# Usage:  source ./activate_native.sh
# Then:   cd ros2_ws && colcon build && ros2 run <pkg> <node>

source /opt/homebrew/Caskroom/miniforge/base/etc/profile.d/conda.sh
conda activate ros2_humble

# Source workspace overlay if already built
if [ -f "$(dirname "${BASH_SOURCE[0]}")/ros2_ws/install/setup.bash" ]; then
  source "$(dirname "${BASH_SOURCE[0]}")/ros2_ws/install/setup.bash"
fi

export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp

echo "✓ Native ROS2 $ROS_DISTRO active (conda env: ros2_humble)"
echo "  ros2, colcon, rviz2, gazebo are on PATH"
