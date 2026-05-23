#!/usr/bin/env bash
# Shared bootstrap: activate native RoboStack env + workspace overlay.
# Sourced by the other run-*.sh helpers.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export DOCKEROS_ROOT="$HERE"

# conda activate
source /opt/homebrew/Caskroom/miniforge/base/etc/profile.d/conda.sh
conda activate ros2_humble

# Force conda env's Python to win over any earlier `python3` on PATH (e.g., brew python@3.14).
# Needed for rosbridge scripts that use `#!/usr/bin/env python3`.
export PATH="$CONDA_PREFIX/bin:$PATH"

# make sure XQuartz is up and focus it so windows are visible
open -a XQuartz 2>/dev/null || true

# workspace overlay (source *.sh — works in bash and zsh)
if [ -f "$DOCKEROS_ROOT/ros2_ws/install/setup.sh" ]; then
  # shellcheck disable=SC1091
  . "$DOCKEROS_ROOT/ros2_ws/install/setup.sh"
fi

export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
