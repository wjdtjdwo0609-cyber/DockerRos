#!/usr/bin/env bash
# Package web viewer as a self-contained static site (symlinks resolved to real files).
# Output goes to web/_dist/ — upload that folder to GitHub Pages, Vercel, Netlify, etc.
set -e
set +u

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/_dist"

echo "[1/3] Regenerating URDFs…"
"$ROOT/generate-urdf.sh" > /dev/null

echo "[2/3] Copying into $DIST (resolving symlinks)…"
rm -rf "$DIST"
mkdir -p "$DIST"

# Copy static files and browser modules
cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/styles.css" "$ROOT/socket_picking_bridge.js" "$DIST/"
cp -R "$ROOT/src" "$DIST/src"

# Copy robots — dereference symlinks so the dist folder is standalone
mkdir -p "$DIST/robots"
for robot_dir in "$ROOT/robots"/*/; do
  name="$(basename "$robot_dir")"
  mkdir -p "$DIST/robots/$name"
  cp "$robot_dir"/*.urdf "$DIST/robots/$name/"
  # Follow the meshes symlink and copy contents
  cp -RL "$robot_dir/meshes" "$DIST/robots/$name/meshes"
done

# drop unused mesh formats to shrink size (optional — keep STL+DAE only)
find "$DIST/robots" -type f \
  ! -name "*.stl" ! -name "*.STL" \
  ! -name "*.dae" ! -name "*.DAE" \
  ! -name "*.urdf" -delete 2>/dev/null || true

SIZE=$(du -sh "$DIST" | awk '{print $1}')
echo "[3/3] Done. $DIST ($SIZE)"
echo ""
echo "배포:"
echo "  • GitHub Pages  :  gh repo create & push _dist to gh-pages branch"
echo "  • Vercel/Netlify:  Set output dir to web/_dist/"
echo "  • 간단 테스트   :  cd _dist && python3 -m http.server 8081"
