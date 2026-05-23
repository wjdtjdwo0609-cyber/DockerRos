import * as THREE from 'three';
import { SimObject } from '../domain/SimObject.js';

// ── Vision Camera (trainable classifier mock) ───────────────────────────
// Detects Socket8 / Socket12 objects within a forward-cone range. `good` is
// true when the detected type appears in the trained-toggle list — this maps
// to X021 (VisionDetect) in the PLC tag catalog.
export class VisionCamera extends SimObject {
  constructor(opts = {}) {
    super('VisionCamera');
    const range = opts.range ?? 0.35;

    this.params = {
      attached: false,         // true = parented to active robot's TCP link
      learned8pin: false,
      learned12pin: false,
      detecting: false,
      detectedType: null,
      good: false,
      range,
    };
    this._attachedRobotId = null;
    this._savedTransform = null;  // preserves world-frame transform for detach

    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x2a3040, shininess: 60 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), bodyMat);
    body.position.y = 0.04;

    const lensMat = new THREE.MeshPhongMaterial({ color: 0x0a0a0a, specular: 0x556677, shininess: 160 });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.022, 20), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.04, 0.05);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.021, 0.002, 8, 20),
      new THREE.MeshPhongMaterial({ color: 0x888888 }),
    );
    ring.position.set(0, 0.04, 0.062);
    ring.rotation.x = Math.PI / 2;

    this._ledMat = new THREE.MeshPhongMaterial({
      color: 0x555566, emissive: 0x111111, emissiveIntensity: 0.8,
    });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 14, 10), this._ledMat);
    led.position.set(0.022, 0.065, 0.038);

    // FOV cone — visualises detection range along +Z.
    // Two layers: bright outline + a faint translucent fill for clear depth
    // perception against the dark background.
    const coneGeom = new THREE.ConeGeometry(range * 0.4, range, 24, 1, true);
    const edges = new THREE.EdgesGeometry(coneGeom);
    this._fovMat = new THREE.LineBasicMaterial({
      color: 0xff9a5a, transparent: true, opacity: 0.85, depthWrite: false,
    });
    const fov = new THREE.LineSegments(edges, this._fovMat);
    // ConeGeometry has its tip at +Y. We want the tip at the LENS
    // (small +Z) and the wide base at the far end (large +Z) so the
    // FOV reads as a real "expanding from the lens" cone — rotate by
    // -π/2 about X so +Y → -Z, putting the tip at small z.
    fov.rotation.x = -Math.PI / 2;
    fov.position.set(0, 0.04, 0.065 + range / 2);
    this._fov = fov;
    this._fovCenterOffset = new THREE.Vector3(0, 0.04, 0.065 + range / 2);

    // Translucent fill so the FOV reads as a volume, not just lines.
    this._fovFillMat = new THREE.MeshBasicMaterial({
      color: 0xff9a5a, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const fovFill = new THREE.Mesh(coneGeom.clone(), this._fovFillMat);
    fovFill.rotation.x = -Math.PI / 2;
    fovFill.position.copy(fov.position);

    // Bright ring at the far end so the detection plane is unambiguous.
    const ringGeom = new THREE.TorusGeometry(range * 0.4, 0.0035, 8, 32);
    this._fovRingMat = new THREE.MeshBasicMaterial({
      color: 0xff9a5a, transparent: true, opacity: 0.9, depthWrite: false,
    });
    const fovRing = new THREE.Mesh(ringGeom, this._fovRingMat);
    fovRing.rotation.x = Math.PI / 2;
    fovRing.position.set(0, 0.04, 0.065 + range);
    this._fovRing = fovRing;

    this.root.add(body, lens, ring, led, fov, fovFill, fovRing);

    this.ui = [
      { type: 'toggle', label: '활성 로봇에 부착 (eye-in-hand)', param: 'attached' },
      { type: 'readout', label: '부착 대상', get: () => {
        if (!this.params.attached || this._attachedRobotId === null) return '없음 (독립)';
        const rm = this.registry?.robotManager;
        const r = rm?.robots?.get(this._attachedRobotId);
        return r ? `${r.type} #${r.id} TCP` : '(로봇 제거됨)';
      }},
      { type: 'toggle', label: '8핀 소켓 학습됨', param: 'learned8pin' },
      { type: 'toggle', label: '12핀 소켓 학습됨', param: 'learned12pin' },
      { type: 'readout', label: '감지 타입', get: () => this.params.detectedType ?? '없음' },
      { type: 'readout', label: '판정', get: () => {
        if (!this.params.detecting) return '—';
        if (this.params.good) return '🟢 양품';
        if (this.params.detectedDefective) return '🔴 불량 (결함 표시)';
        return '🔴 불량 (미학습 타입)';
      }},
      { type: 'readout', label: '감지 범위', get: () => `${range.toFixed(2)} m` },
      { type: 'opcuaBinding', direction: 'write', paramName: 'good' },
    ];
    this.opcua.paramName = 'good';

    this._tmpCenter = new THREE.Vector3();
    this._tmpPos = new THREE.Vector3();
  }

  setParam(name, value) {
    if (name === 'attached') {
      // Attach/detach is a side-effectful scene graph re-parent; handle
      // separately so params reflects the actual attachment state.
      if (value) this._attach();
      else this._detach();
      return;
    }
    super.setParam(name, value);
  }

  _attach() {
    if (this._attachedRobotId !== null) return; // already attached
    const rm = this.registry?.robotManager;
    const robot = rm?.active;
    if (!robot) {
      console.warn('[VisionCamera] 활성 로봇이 없어서 부착 실패');
      return;
    }
    const tcp = robot.urdf.links[robot.cfg.tcp];
    if (!tcp) {
      console.warn('[VisionCamera] TCP link 없음:', robot.type);
      return;
    }
    // Preserve current world transform so detach returns to the same spot.
    this._savedTransform = {
      parent: this.root.parent,
      position: this.root.position.clone(),
      rotation: this.root.rotation.clone(),
      scale: this.root.scale.clone(),
    };
    tcp.add(this.root);
    // Mount camera 6cm in front of TCP, facing along TCP's +Z (tool axis).
    this.root.position.set(0, 0, 0.06);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this._attachedRobotId = robot.id;
    super.setParam('attached', true);
  }

  _detach() {
    if (this._attachedRobotId === null) {
      super.setParam('attached', false);
      return;
    }
    const saved = this._savedTransform;
    if (saved && saved.parent) {
      saved.parent.add(this.root);
      this.root.position.copy(saved.position);
      this.root.rotation.copy(saved.rotation);
      this.root.scale.copy(saved.scale);
    }
    this._savedTransform = null;
    this._attachedRobotId = null;
    super.setParam('attached', false);
  }

  update(_dt) {
    // If the robot we're attached to was removed, gracefully detach.
    if (this._attachedRobotId !== null) {
      const rm = this.registry?.robotManager;
      if (!rm?.robots?.has(this._attachedRobotId)) {
        this._detach();
      }
    }
    if (!this.registry) return;
    // Detection center = FOV local offset transformed to world.
    this._tmpCenter.copy(this._fovCenterOffset).applyMatrix4(this.root.matrixWorld);
    const sockets = this.registry.getObjectsByTypes(['8핀소켓', '12핀소켓']);
    let closest = null;
    let closestDist = Infinity;
    const thresh = this.params.range * 0.6; // generous sphere around FOV center
    for (const s of sockets) {
      s.root.getWorldPosition(this._tmpPos);
      const d = this._tmpPos.distanceTo(this._tmpCenter);
      if (d < thresh && d < closestDist) {
        closestDist = d;
        closest = s;
      }
    }
    const detecting = closest !== null;
    let good = false;
    if (detecting) {
      const learned = (closest.type === '8핀소켓' && this.params.learned8pin)
                   || (closest.type === '12핀소켓' && this.params.learned12pin);
      // Defective sockets fail QC even if the type is learned — that's the
      // whole point of having a vision check.
      good = learned && !closest.params?.defective;
    }
    this.params.detecting = detecting;
    this.params.detectedType = closest?.type ?? null;
    this.params.detectedDefective = !!closest?.params?.defective;
    this.params.good = good;

    // Visual feedback: LED color + FOV cone color (line, fill, ring layers).
    // Idle: warm orange — readable against dark bg without being alarming.
    const idleColor = 0xff9a5a;
    const goodColor = 0x22ff66;
    const badColor = 0xff3344;
    const fovColor = !detecting ? idleColor : (good ? goodColor : badColor);
    const ledColor = !detecting ? 0x555566 : fovColor;
    const ledEmissive = !detecting ? 0x111111 : fovColor;
    this._ledMat.color.setHex(ledColor);
    this._ledMat.emissive.setHex(ledEmissive);
    this._fovMat.color.setHex(fovColor);
    this._fovMat.opacity = detecting ? 0.95 : 0.85;
    this._fovFillMat.color.setHex(fovColor);
    this._fovFillMat.opacity = detecting ? 0.16 : 0.08;
    this._fovRingMat.color.setHex(fovColor);
    this._fovRingMat.opacity = detecting ? 1.0 : 0.9;
  }
}
