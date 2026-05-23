// Camera presets + eased focus-on-selection.
//
// Factory pattern: bind to a specific (camera, orbit) pair so app.js can
// just call cam.applyPreset('iso') / cam.focusOn(node) / cam.stepAnim()
// without juggling shared module state.
//
// The animation is a simple lerp on camera.position + orbit.target with
// an ease-in-out-quad curve. While an animation is in flight, isAnimating()
// returns true so other systems (keyboard pan) can avoid fighting it.

import * as THREE from 'three';

export const VIEW_PRESETS = {
  iso:   { pos: [1.6, 1.6, 1.6],  target: [0, 0.3, 0] },
  top:   { pos: [0,   3.5, 0.001], target: [0, 0, 0] },
  front: { pos: [0,   0.6, 2.8],  target: [0, 0.5, 0] },
  side:  { pos: [2.8, 0.6, 0],    target: [0, 0.5, 0] },
};

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function createCameraControls({ camera, orbit }) {
  // { startTime, duration, fromCam, toCam, fromTarget, toTarget }
  let anim = null;

  function startMove(toCameraPos, toTargetPos, duration = 450) {
    anim = {
      startTime: performance.now(),
      duration,
      fromCam: camera.position.clone(),
      toCam: toCameraPos.clone(),
      fromTarget: orbit.target.clone(),
      toTarget: toTargetPos.clone(),
    };
  }

  function stepAnim() {
    if (!anim) return;
    const t = Math.min((performance.now() - anim.startTime) / anim.duration, 1);
    const e = easeInOutQuad(t);
    camera.position.lerpVectors(anim.fromCam, anim.toCam, e);
    orbit.target.lerpVectors(anim.fromTarget, anim.toTarget, e);
    if (t >= 1) anim = null;
  }

  function applyPreset(name) {
    const p = VIEW_PRESETS[name];
    if (!p) return;
    startMove(new THREE.Vector3(...p.pos), new THREE.Vector3(...p.target));
  }

  function focusOn(object3D) {
    if (!object3D) return;
    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    // Keep current view direction, but reframe at a distance proportional to object size.
    const dir = new THREE.Vector3().subVectors(camera.position, orbit.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 1, 1);
    dir.normalize();
    const distance = Math.max(size * 1.8, 0.6);
    const newCamPos = new THREE.Vector3().copy(center).addScaledVector(dir, distance);
    startMove(newCamPos, center);
  }

  return {
    applyPreset,
    focusOn,
    startMove,
    stepAnim,
    isAnimating: () => anim !== null,
  };
}
