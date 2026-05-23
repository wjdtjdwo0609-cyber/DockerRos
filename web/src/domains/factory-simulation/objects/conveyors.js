import * as THREE from 'three';
import { SimObject } from '../domain/SimObject.js';

// ── ConveyorBelt ────────────────────────────────────────────────────────
export class ConveyorBelt extends SimObject {
  constructor(opts = {}) {
    super('Conveyor');
    const length = opts.length ?? 0.8;
    const width = opts.width ?? 0.2;
    const beltThickness = 0.02;
    const legHeight = 0.18;

    this.params = { speed: 0.3, running: false, length, width };

    // Scrolling chevron texture — pure canvas, no external assets.
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1e'; ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = '#ff9a5a'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    for (let i = -1; i < 5; i++) {
      const x = i * 32;
      ctx.beginPath();
      ctx.moveTo(x, 8); ctx.lineTo(x + 14, 32); ctx.lineTo(x, 56);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(2, Math.round(length * 5)), 1);
    texture.anisotropy = 4;
    this._beltTexture = texture;

    const beltMat = new THREE.MeshPhongMaterial({ map: texture, shininess: 20 });
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(length, beltThickness, width),
      beltMat,
    );
    belt.position.y = legHeight + beltThickness / 2;

    const railMat = new THREE.MeshPhongMaterial({ color: 0x5a6470, shininess: 60 });
    const rail1 = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.025, 0.015), railMat,
    );
    rail1.position.set(0, legHeight + beltThickness + 0.01, width / 2 + 0.01);
    const rail2 = rail1.clone();
    rail2.position.z = -width / 2 - 0.01;

    const legMat = new THREE.MeshPhongMaterial({ color: 0x3a3f48 });
    const legGeom = new THREE.BoxGeometry(0.035, legHeight, 0.035);
    const legOffsetX = length / 2 - 0.05;
    const legOffsetZ = width / 2 - 0.025;
    const legs = [];
    for (const x of [-legOffsetX, legOffsetX]) {
      for (const z of [-legOffsetZ, legOffsetZ]) {
        const leg = new THREE.Mesh(legGeom, legMat);
        leg.position.set(x, legHeight / 2, z);
        legs.push(leg);
      }
    }

    this.root.add(belt, rail1, rail2, ...legs);

    this.ui = [
      { type: 'toggleButton', param: 'running', labelOn: '⏸ 정지', labelOff: '▶ 실행' },
      { type: 'slider', label: '설정 속도 (m/s)', param: 'speed',
        min: -1, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
      { type: 'readout', label: '길이 / 폭',
        get: () => `${length.toFixed(2)} × ${width.toFixed(2)} m` },
      { type: 'opcuaBinding', direction: 'read', paramName: 'running' },
    ];
    this.opcua.paramName = 'running';
  }

  update(dt) {
    // Effective speed is zero unless the belt is "running".
    const effectiveSpeed = this.params.running ? this.params.speed : 0;
    // Belt surface advances at effectiveSpeed m/s. Texture u-axis is scaled by
    // repeat.x, so to match real-world motion we divide by the segment length
    // each repeat represents (= length / repeat.x).
    const metersPerRepeat = this.params.length / this._beltTexture.repeat.x;
    this._beltTexture.offset.x += (effectiveSpeed * dt) / metersPerRepeat;
  }
}

// ── Cylinder (pneumatic) ────────────────────────────────────────────────
export class Cylinder extends SimObject {
  constructor(opts = {}) {
    super('Cylinder');
    const bodyLength = opts.bodyLength ?? 0.14;
    const bodyRadius = opts.bodyRadius ?? 0.025;
    const strokeMax = opts.stroke ?? 0.1;
    const rodRadius = 0.008;
    const rodLength = strokeMax + 0.04;

    this.params = { stroke: 0, target: 0, speed: 0.3, running: false, strokeMax };

    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x4a5260, shininess: 60 });
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyLength, 20),
      bodyMat,
    );
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.08;

    // Mounting base so it doesn't float.
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.02, 0.08),
      new THREE.MeshPhongMaterial({ color: 0x3a3f48 }),
    );
    base.position.set(-bodyLength / 2 - 0.01, 0.01, 0);

    const rodMat = new THREE.MeshPhongMaterial({ color: 0xd8dde3, shininess: 120 });
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(rodRadius, rodRadius, rodLength, 12),
      rodMat,
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 0.08;
    this._rod = rod;

    const tipMat = new THREE.MeshPhongMaterial({ color: 0xff9a5a, shininess: 80 });
    const tip = new THREE.Mesh(
      new THREE.CylinderGeometry(rodRadius * 1.5, rodRadius * 1.5, 0.012, 12),
      tipMat,
    );
    tip.rotation.z = Math.PI / 2;
    this._tip = tip;
    rod.add(tip);
    // Tip anchored to the +X end of the rod (local +Y in rod frame after rotation).
    tip.position.y = rodLength / 2 + 0.006;

    this._bodyEndX = bodyLength / 2;
    this._rodLength = rodLength;
    this._updateRodPosition(0);

    this.root.add(base, body, rod);

    this.ui = [
      { type: 'toggleButton', param: 'running', labelOn: '⏸ 정지 (싸이클)', labelOff: '▶ 실행 (싸이클)' },
      { type: 'slider', label: '목표 스트로크 (m)', param: 'target',
        min: 0, max: strokeMax, step: 0.001, format: (v) => v.toFixed(3) },
      { type: 'buttonRow', buttons: [
        { label: '확장', action: () => this.setParam('target', strokeMax) },
        { label: '수축', action: () => this.setParam('target', 0) },
      ]},
      { type: 'slider', label: '속도 (m/s)', param: 'speed',
        min: 0.05, max: 1.0, step: 0.01, format: (v) => v.toFixed(2) },
      { type: 'readout', label: '현재 스트로크',
        get: () => `${this.params.stroke.toFixed(3)} m` },
      { type: 'opcuaBinding', direction: 'read', paramName: 'running' },
    ];
    this.opcua.paramName = 'running';
  }

  _updateRodPosition(stroke) {
    // At stroke=0 the rod tip sits just past the body end; stroke extends +X.
    this._rod.position.x = this._bodyEndX + this._rodLength / 2 - this._rodLength / 2 + stroke - 0.02;
  }

  update(dt) {
    // When running, auto-cycle target between 0 and strokeMax each time stroke
    // reaches the current target. Manual target slider still works when stopped.
    if (this.params.running && Math.abs(this.params.target - this.params.stroke) < 1e-4) {
      this.params.target = this.params.target > this.params.strokeMax / 2 ? 0 : this.params.strokeMax;
    }
    const { stroke, target, speed } = this.params;
    const diff = target - stroke;
    if (Math.abs(diff) >= 1e-4) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
      this.params.stroke = stroke + step;
      this._updateRodPosition(this.params.stroke);
    }
    // Fire `_onExtended` ONCE per cycle, the moment stroke crosses 90% of
    // strokeMax in the +direction. Used by feeders to dispense exactly one
    // part per push instead of two (which would happen on a 0% threshold
    // since strokes wobble around 0).
    const wasExtended = this._wasExtended ?? false;
    const isExtended = this.params.stroke > this.params.strokeMax * 0.9;
    if (isExtended && !wasExtended) this._onExtended?.();
    this._wasExtended = isExtended;
  }
}

// ── Sensor (photoelectric / proximity) ──────────────────────────────────
export class Sensor extends SimObject {
  constructor(opts = {}) {
    super('Sensor');
    const range = opts.range ?? 0.3;

    this.params = { detected: false, range };

    const housingMat = new THREE.MeshPhongMaterial({ color: 0x2a3040, shininess: 40 });
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.04),
      housingMat,
    );
    housing.position.y = 0.025;

    this._ledMat = new THREE.MeshPhongMaterial({
      color: 0x00ff66, emissive: 0x00ff66, emissiveIntensity: 0.9, shininess: 80,
    });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 14, 10), this._ledMat);
    led.position.set(0, 0.05, 0.018);

    this._beamMat = new THREE.MeshBasicMaterial({
      color: 0x00ff66, transparent: true, opacity: 0.35, depthWrite: false,
    });
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0015, 0.0015, range, 8),
      this._beamMat,
    );
    beam.rotation.z = Math.PI / 2;
    beam.position.set(range / 2 + 0.025, 0.025, 0);
    this._beam = beam;

    this.root.add(housing, led, beam);

    this.ui = [
      { type: 'toggle', label: '감지 (수동)', param: 'detected' },
      { type: 'readout', label: '범위',
        get: () => `${this.params.range.toFixed(2)} m` },
      { type: 'readout', label: '상태',
        get: () => this.params.detected ? '🔴 DETECTED' : '🟢 CLEAR' },
      { type: 'opcuaBinding', direction: 'write', paramName: 'detected' },
    ];
    this.opcua.paramName = 'detected';
  }

  update(_dt) {
    const c = this.params.detected ? 0xff3344 : 0x00ff66;
    this._ledMat.color.setHex(c);
    this._ledMat.emissive.setHex(c);
    this._beamMat.color.setHex(c);
  }
}

// ── Vertical Conveyor / Stacking Elevator ───────────────────────────────
// Platform moves up and down along a vertical column. In "running" mode it
// auto-cycles between 0 ↔ 1; target slider overrides when stopped.
export class VerticalConveyor extends SimObject {
  constructor(opts = {}) {
    super('Elevator');
    const height = opts.height ?? 1.0;
    const platformSize = opts.platformSize ?? 0.22;

    this.params = {
      running: false, speed: 0.3, level: 0, target: 1, height, platformSize,
    };

    const frameMat = new THREE.MeshPhongMaterial({ color: 0x4a5260, shininess: 60 });
    const legGeom = new THREE.BoxGeometry(0.025, height, 0.025);
    const legOff = platformSize / 2 + 0.02;
    const legs = [];
    for (const [x, z] of [[-legOff, -legOff], [legOff, -legOff], [legOff, legOff], [-legOff, legOff]]) {
      const l = new THREE.Mesh(legGeom, frameMat);
      l.position.set(x, height / 2, z);
      legs.push(l);
    }

    const pulleyMat = new THREE.MeshPhongMaterial({ color: 0x666a72, shininess: 80 });
    const pulleyGeom = new THREE.CylinderGeometry(0.025, 0.025, platformSize + 0.05, 16);
    const pulleyTop = new THREE.Mesh(pulleyGeom, pulleyMat);
    pulleyTop.rotation.x = Math.PI / 2;
    pulleyTop.position.y = height - 0.025;
    const pulleyBot = pulleyTop.clone();
    pulleyBot.position.y = 0.025;

    // Belt strands — two thin verticals on each side of the platform.
    const beltMat = new THREE.MeshBasicMaterial({ color: 0xff9a5a, transparent: true, opacity: 0.7 });
    const beltGeom = new THREE.BoxGeometry(0.004, height - 0.05, 0.004);
    const beltOffsets = [[-platformSize/2 - 0.015, 0], [platformSize/2 + 0.015, 0]];
    const belts = beltOffsets.map(([x, z]) => {
      const b = new THREE.Mesh(beltGeom, beltMat);
      b.position.set(x, height / 2, z);
      return b;
    });

    const platMat = new THREE.MeshPhongMaterial({ color: 0xff9a5a, specular: 0x553322, shininess: 60 });
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(platformSize, 0.02, platformSize),
      platMat,
    );
    this._platform = platform;

    this.root.add(...legs, pulleyTop, pulleyBot, ...belts, platform);
    this._updatePlatform();

    this.ui = [
      { type: 'toggleButton', param: 'running', labelOn: '⏸ 정지 (싸이클)', labelOff: '▶ 실행 (싸이클)' },
      { type: 'slider', label: '목표 위치 (0-1)', param: 'target', min: 0, max: 1, step: 0.01,
        format: (v) => v.toFixed(2) },
      { type: 'slider', label: '속도 (m/s)', param: 'speed', min: 0.05, max: 1, step: 0.01,
        format: (v) => v.toFixed(2) },
      { type: 'readout', label: '현재 높이', get: () =>
        `${(this.params.level * this.params.height).toFixed(2)} / ${this.params.height.toFixed(2)} m` },
      { type: 'opcuaBinding', direction: 'read', paramName: 'running' },
    ];
    this.opcua.paramName = 'running';
  }

  _updatePlatform() {
    const travel = this.params.height - 0.1;
    this._platform.position.y = 0.06 + this.params.level * travel;
  }

  update(dt) {
    if (this.params.running && Math.abs(this.params.target - this.params.level) < 1e-3) {
      this.params.target = this.params.target > 0.5 ? 0 : 1;
    }
    const diff = this.params.target - this.params.level;
    if (Math.abs(diff) < 1e-4) return;
    const maxStep = (this.params.speed * dt) / this.params.height;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    this.params.level = THREE.MathUtils.clamp(this.params.level + step, 0, 1);
    this._updatePlatform();
  }
}
