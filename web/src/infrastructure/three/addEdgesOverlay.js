import * as THREE from 'three';

const EDGE_COLOR = 0x6a7280;
export const EDGE_OPACITY = 0.5;
const EDGE_THRESHOLD_DEG = 20;

export function addEdgesOverlay(root) {
  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    if (child.userData.hasEdgeOverlay) return;
    const edges = new THREE.EdgesGeometry(child.geometry, EDGE_THRESHOLD_DEG);
    const material = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: EDGE_OPACITY,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(edges, material);
    lines.userData.isEdgeOverlay = true;
    child.add(lines);
    child.userData.hasEdgeOverlay = true;
  });
}
