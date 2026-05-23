"""Generic URDF viewer — accepts URDF or xacro.
Args:
  urdf:=<absolute path>            # required
  xacro_args:="k1:=v1 k2:=v2"      # optional, only for .xacro files
"""
import os
import xacro
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, OpaqueFunction
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def _parse_xacro_args(raw: str) -> dict:
    mappings = {}
    for part in raw.split():
        if ':=' in part:
            k, v = part.split(':=', 1)
            mappings[k] = v
    return mappings


def _load_robot_description(context, *args, **kwargs):
    urdf_path = LaunchConfiguration('urdf').perform(context)
    xacro_args_raw = LaunchConfiguration('xacro_args').perform(context)

    if not os.path.isfile(urdf_path):
        raise RuntimeError(f'URDF not found: {urdf_path}')

    if urdf_path.endswith('.xacro') or urdf_path.endswith('.urdf.xacro'):
        mappings = _parse_xacro_args(xacro_args_raw)
        doc = xacro.process_file(urdf_path, mappings=mappings)
        robot_description = doc.toprettyxml(indent='  ')
    else:
        with open(urdf_path, 'r') as f:
            robot_description = f.read()

    return [
        Node(
            package='robot_state_publisher',
            executable='robot_state_publisher',
            parameters=[{'robot_description': robot_description}],
            output='screen',
        ),
        Node(
            package='joint_state_publisher_gui',
            executable='joint_state_publisher_gui',
            output='screen',
        ),
        Node(
            package='rviz2',
            executable='rviz2',
            output='screen',
            arguments=['-d', os.path.join(
                get_package_share_directory('robot_viewer'),
                'launch',
                'default.rviz',
            )],
        ),
    ]


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('urdf', description='Absolute path to URDF or xacro file'),
        DeclareLaunchArgument('xacro_args', default_value='',
                              description='Space-separated key:=value pairs for xacro processing'),
        OpaqueFunction(function=_load_robot_description),
    ])
