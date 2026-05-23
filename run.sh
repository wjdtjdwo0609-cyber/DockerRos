#!/usr/bin/env bash
# Quick helpers for the DockerRos stack.
# Usage:
#   ./run.sh build    # build image
#   ./run.sh up       # start container (detached)
#   ./run.sh shell    # exec bash in running container
#   ./run.sh down     # stop & remove container
#   ./run.sh rebuild  # no-cache rebuild
#
# macOS GUI (RViz, rqt):
#   1) brew install --cask xquartz && open -a XQuartz
#   2) XQuartz Preferences > Security > "Allow connections from network clients" ON
#   3) xhost + 127.0.0.1
#   4) DISPLAY=host.docker.internal:0 ./run.sh up
set -euo pipefail

cd "$(dirname "$0")"

prepare_xauth() {
  local xauth=/tmp/.docker.xauth
  # wildcard cookie so it matches any connecting host
  if command -v /opt/X11/bin/xauth >/dev/null 2>&1; then
    touch "$xauth"
    rm -f "$xauth"
    /opt/X11/bin/xauth nlist :0 2>/dev/null \
      | sed -e 's/^..../ffff/' \
      | /opt/X11/bin/xauth -f "$xauth" nmerge - 2>/dev/null || true
    chmod 644 "$xauth"
  fi
}

case "${1:-shell}" in
  build)    docker compose build ;;
  rebuild)  docker compose build --no-cache ;;
  up)       prepare_xauth; open -a XQuartz 2>/dev/null || true; docker compose up -d ;;
  gui)      prepare_xauth; open -a XQuartz 2>/dev/null || true; docker compose restart ros2 ;;
  down)     docker compose down ;;
  shell)    docker compose exec ros2 bash || docker compose run --rm ros2 bash ;;
  logs)     docker compose logs -f ;;
  *)        echo "unknown command: $1"; exit 1 ;;
esac
