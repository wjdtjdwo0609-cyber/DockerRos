#!/usr/bin/env bash
# Regenerate web-safe URDFs from the ros2_ws sources.
# Converts absolute `file:///…` mesh URIs → relative `meshes/…`.
set -e
set +u   # conda activate scripts poke at undefined vars

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_PATH="/opt/homebrew/Caskroom/miniforge/base/envs/ros2_humble"
source /opt/homebrew/Caskroom/miniforge/base/etc/profile.d/conda.sh
conda activate ros2_humble
# shellcheck disable=SC1091
source "$ROOT/../ros2_ws/install/setup.sh"

INDY_SHARE="$(cd "$ROOT/../ros2_ws/install/indy_description/share/indy_description" && pwd -P)"
UR_SHARE="$(cd "$ENV_PATH/share/ur_description" && pwd -P)"
PANDA_SHARE="$(cd "$ENV_PATH/share/moveit_resources_panda_description" && pwd -P)"
FANUC_SHARE="$(cd "$ENV_PATH/share/moveit_resources_fanuc_description" && pwd -P)"

# ── Indy7 (Neuromeka) ─────────────────────────────────────────────────
emit_indy() {
  local type="$1"; local slug="$2"
  local dir="$ROOT/robots/$slug"
  mkdir -p "$dir"
  xacro "$INDY_SHARE/urdf/indy.urdf.xacro" name:=indy indy_type:="$type" 2>/dev/null \
    | sed "s|file://$INDY_SHARE/||g" > "$dir/$slug.urdf"
  ln -sfn "$INDY_SHARE/meshes" "$dir/meshes"
  echo "[ok] $slug → $dir"
}
emit_indy indy7 indy7
emit_indy indy12 indy12

# ── UR (Universal Robots) ─────────────────────────────────────────────
emit_ur() {
  local type="$1"; local slug="$2"
  local dir="$ROOT/robots/$slug"
  mkdir -p "$dir"
  xacro "$UR_SHARE/urdf/ur.urdf.xacro" name:=ur ur_type:="$type" 2>/dev/null \
    | sed "s|package://ur_description/|./|g" > "$dir/$slug.urdf"
  ln -sfn "$UR_SHARE/meshes" "$dir/meshes"
  echo "[ok] $slug → $dir"
}
emit_ur ur5e ur5e
emit_ur ur10e ur10e

# ── Panda (Franka Emika, 7-DOF) ───────────────────────────────────────
PANDA_DIR="$ROOT/robots/panda"
mkdir -p "$PANDA_DIR"
# This URDF is plain (not xacro) and uses package:// URIs
sed "s|package://moveit_resources_panda_description/|./|g" "$PANDA_SHARE/urdf/panda.urdf" \
  > "$PANDA_DIR/panda.urdf"
ln -sfn "$PANDA_SHARE/meshes" "$PANDA_DIR/meshes"
echo "[ok] panda → $PANDA_DIR"

# ── Fanuc M-10iA (6-DOF industrial) ───────────────────────────────────
FANUC_DIR="$ROOT/robots/fanuc"
mkdir -p "$FANUC_DIR"
sed "s|package://moveit_resources_fanuc_description/|./|g" "$FANUC_SHARE/urdf/fanuc.urdf" \
  > "$FANUC_DIR/fanuc.urdf"
ln -sfn "$FANUC_SHARE/meshes" "$FANUC_DIR/meshes"
echo "[ok] fanuc → $FANUC_DIR"

echo ""
echo "Done. All 5 robots exported to $ROOT/robots/"
