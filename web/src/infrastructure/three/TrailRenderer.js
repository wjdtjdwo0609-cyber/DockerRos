// TCP-tip trail renderer. Buffers world-space positions sampled from a
// robot's active tool tip and renders them as a continuous Line strip.
// Used to visualise the path drawn by a "pen" tool — the operator can
// see exactly what the robot's wrist is tracing through space.

import * as THREE from 'three';

export class TrailRenderer {
  constructor(scene, opts = {}) {
    this.maxPoints = opts.maxPoints ?? 6000;
    this.minStep   = opts.minStep   ?? 0.0015;  // skip points <1.5mm apart
    this._count = 0;
    this._lastAdded = new THREE.Vector3(NaN, NaN, NaN);

    this.geom = new THREE.BufferGeometry();
    this._positions = new Float32Array(this.maxPoints * 3);
    this.geom.setAttribute('position',
      new THREE.BufferAttribute(this._positions, 3));
    this.geom.setDrawRange(0, 0);

    this.mat = new THREE.LineBasicMaterial({
      color: opts.color ?? 0xff9a5a,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.line = new THREE.Line(this.geom, this.mat);
    this.line.frustumCulled = false;
    scene.add(this.line);
    this._scene = scene;
    this.enabled = false;
  }

  addPoint(worldPos) {
    if (!this.enabled) return;
    if (this._count >= this.maxPoints) return;
    if (this._count > 0 &&
        this._lastAdded.distanceToSquared(worldPos) < this.minStep * this.minStep) {
      return;
    }
    const i = this._count * 3;
    this._positions[i]     = worldPos.x;
    this._positions[i + 1] = worldPos.y;
    this._positions[i + 2] = worldPos.z;
    this._count += 1;
    this._lastAdded.copy(worldPos);
    this.geom.attributes.position.needsUpdate = true;
    this.geom.setDrawRange(0, this._count);
  }

  clear() {
    this._count = 0;
    this._lastAdded.set(NaN, NaN, NaN);
    this.geom.setDrawRange(0, 0);
    this.geom.attributes.position.needsUpdate = true;
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.line.visible = this.enabled || this._count > 0;
  }

  setColor(hex) {
    this.mat.color.setHex(hex);
  }

  dispose() {
    this._scene.remove(this.line);
    this.geom.dispose();
    this.mat.dispose();
  }
}
