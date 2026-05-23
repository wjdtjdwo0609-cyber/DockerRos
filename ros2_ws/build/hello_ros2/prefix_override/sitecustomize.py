import sys
if sys.prefix == '/opt/homebrew/Caskroom/miniforge/base/envs/ros2_humble':
    sys.real_prefix = sys.prefix
    sys.prefix = sys.exec_prefix = '/Users/tjdwo0609/Documents/DockerRos/ros2_ws/install/hello_ros2'
