#!/usr/bin/env bash
# Generic URDF viewer — any robot you have a URDF/xacro for.
# Usage:
#   ./scripts/run-robot-viewer.sh <absolute-path-to-urdf>
#   ./scripts/run-robot-viewer.sh ur5e       # shortcut for UR5e
#   ./scripts/run-robot-viewer.sh panda      # Franka Panda 7-DOF
#   ./scripts/run-robot-viewer.sh fanuc      # Fanuc M-10iA 6-DOF
#   ./scripts/run-robot-viewer.sh <path>.urdf  # custom URDF file
source "$(dirname "$0")/_common.sh"

ENV_SHARE="/opt/homebrew/Caskroom/miniforge/base/envs/ros2_humble/share"

TARGET="${1:-ur5e}"
case "$TARGET" in
  ur3e|ur5|ur5e|ur10|ur10e|ur16e|ur20|ur30)
    # UR has its own launch
    exec ros2 launch ur_description view_ur.launch.py ur_type:="$TARGET"
    ;;
  panda|franka)
    URDF="$ENV_SHARE/moveit_resources_panda_description/urdf/panda.urdf"
    ;;
  fanuc)
    URDF="$ENV_SHARE/moveit_resources_fanuc_description/urdf/fanuc.urdf"
    ;;
  indy7|indy|indy12|indyrp2)
    # Neuromeka Indy series — process xacro on-the-fly so mesh paths resolve correctly
    WS_SHARE="$DOCKEROS_ROOT/ros2_ws/install/indy_description/share/indy_description"
    URDF="$WS_SHARE/urdf/indy.urdf.xacro"
    [ "$TARGET" = "indy" ] && TARGET=indy7
    XACRO_ARGS="name:=indy indy_type:=$TARGET"
    ;;
  *)
    URDF="$TARGET"  # treat as path
    ;;
esac

if [ ! -f "$URDF" ]; then
  echo "[ERROR] URDF not found: $URDF"
  exit 1
fi

echo "[INFO] URDF: $URDF"
[ -n "${XACRO_ARGS:-}" ] && echo "[INFO] xacro args: $XACRO_ARGS"
echo "[INFO] XQuartz로 전환해서 RViz + 관절 슬라이더 창 확인"
exec ros2 launch robot_viewer view.launch.py urdf:="$URDF" xacro_args:="${XACRO_ARGS:-}"
