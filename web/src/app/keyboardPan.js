// Arrow-key / WASD camera pan on the horizontal floor plane.
//
// Vertical lift / zoom is left to the trackpad (OrbitControls scroll/pinch).
// Shift = 3× speed. While focused in form fields the keys do nothing.
//
// installKeyboardPan() wires window event listeners once and returns
// applyPan(dt) for the animate loop to call each frame.

import * as THREE from 'three';

// All keys normalized to lowercase ('arrowleft', 'a', …) so the keydown /
// keyup / applyPan code paths see identical strings.
const PAN_KEYS = new Set([
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'w', 'a', 's', 'd',
]);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function installKeyboardPan({ camera, orbit, isCameraAnimating = () => false }) {
  const keysHeld = new Set();
  let shiftHeld = false;

  window.addEventListener('keydown', (ev) => {
    const tag = ev.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.key === 'Shift') shiftHeld = true;
    const k = ev.key.toLowerCase();
    if (PAN_KEYS.has(k)) {
      keysHeld.add(k);
      ev.preventDefault();
    }
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.key === 'Shift') shiftHeld = false;
    keysHeld.delete(ev.key.toLowerCase());
  });
  // Stop sliding if focus leaves the window mid-press (sticky-key bug).
  window.addEventListener('blur', () => { keysHeld.clear(); shiftHeld = false; });

  const forward = new THREE.Vector3();
  const right   = new THREE.Vector3();
  const delta   = new THREE.Vector3();

  function applyPan(dt) {
    if (keysHeld.size === 0) return;
    if (isCameraAnimating()) return;     // don't fight an active preset/focus animation
    const speed = 1.5 * (shiftHeld ? 3 : 1) * dt; // m/s × dt

    // Camera's look direction projected onto the ground plane gives the
    // "forward" axis on the floor. If the camera looks straight down (top
    // preset) the projection collapses — fall back to world -Z.
    forward.subVectors(orbit.target, camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    // Right axis = forward × up (always horizontal because forward is).
    right.crossVectors(forward, WORLD_UP).normalize();

    delta.set(0, 0, 0);
    if (keysHeld.has('arrowleft')  || keysHeld.has('a')) delta.addScaledVector(right,   -speed);
    if (keysHeld.has('arrowright') || keysHeld.has('d')) delta.addScaledVector(right,    speed);
    if (keysHeld.has('arrowup')    || keysHeld.has('w')) delta.addScaledVector(forward,  speed);
    if (keysHeld.has('arrowdown')  || keysHeld.has('s')) delta.addScaledVector(forward, -speed);
    if (delta.lengthSq() > 0) {
      camera.position.add(delta);
      orbit.target.add(delta);
    }
  }

  return { applyPan };
}
