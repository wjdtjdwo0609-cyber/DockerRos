import * as THREE from 'three';
import { SimObject } from '../domain/SimObject.js';

// ── Table ───────────────────────────────────────────────────────────────
export class Table extends SimObject {
  constructor(opts = {}) {
    super('Table');
    const w = opts.width ?? 0.6;
    const d = opts.depth ?? 0.4;
    const h = opts.height ?? 0.5;
    const topTh = 0.02;

    this.params = { width: w, depth: d, height: h };

    const topMat = new THREE.MeshPhongMaterial({ color: 0x9e7b52, shininess: 30 });
    const legMat = new THREE.MeshPhongMaterial({ color: 0x3a3f48, shininess: 40 });

    const top = new THREE.Mesh(new THREE.BoxGeometry(w, topTh, d), topMat);
    top.position.y = h - topTh / 2;

    const legGeom = new THREE.BoxGeometry(0.035, h - topTh, 0.035);
    const legY = (h - topTh) / 2;
    const legPositions = [
      [-w / 2 + 0.04, -d / 2 + 0.04],
      [ w / 2 - 0.04, -d / 2 + 0.04],
      [-w / 2 + 0.04,  d / 2 - 0.04],
      [ w / 2 - 0.04,  d / 2 - 0.04],
    ];
    const legs = legPositions.map(([x, z]) => {
      const l = new THREE.Mesh(legGeom, legMat);
      l.position.set(x, legY, z);
      return l;
    });

    this.root.add(top, ...legs);

    this.ui = [
      { type: 'readout', label: '크기', get: () => `${w.toFixed(2)} × ${d.toFixed(2)} × ${h.toFixed(2)} m` },
    ];
  }
}

// ── Storage Box (open-top bin with count display) ───────────────────────
// `sockType` ('Socket8' | 'Socket12') tags the box visually so the operator
// can tell at a glance which type each magazine/staging bin holds. Tagged
// boxes get a colored rim along the top edges + a "8핀"/"12핀" header on
// the count sprite. Untagged boxes keep the legacy plain look (used for
// reject bins / generic storage).
export class StorageBox extends SimObject {
  constructor(opts = {}) {
    super('StorageBox');
    const w = opts.width ?? 0.18;
    const d = opts.depth ?? 0.18;
    const h = opts.height ?? 0.1;
    const capacity = opts.capacity ?? 10;
    const sockType = opts.sockType ?? null;
    const typeColor = sockType === 'Socket12' ? 0x5aa7ff
                    : sockType === 'Socket8'  ? 0xff9a5a
                    :                            0xff9a5a;
    const typeLabel = sockType === 'Socket12' ? '12핀'
                    : sockType === 'Socket8'  ? '8핀'
                    :                            '';

    this.params = { count: 0, capacity, width: w, depth: d, height: h, sockType };
    this._typeColor = typeColor;
    this._typeLabel = typeLabel;

    const wallMat = new THREE.MeshPhongMaterial({
      color: 0xd8a86a, shininess: 10, transparent: true, opacity: 0.55,
    });
    const baseMat = new THREE.MeshPhongMaterial({ color: 0x8b6f47, shininess: 20 });

    const bottom = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, d), baseMat);
    bottom.position.y = 0.004;
    const wallT = 0.006;
    const front = new THREE.Mesh(new THREE.BoxGeometry(w, h, wallT), wallMat);
    front.position.set(0, h / 2, d / 2 - wallT / 2);
    const back = front.clone(); back.position.z *= -1;
    const left = new THREE.Mesh(new THREE.BoxGeometry(wallT, h, d), wallMat);
    left.position.set(-w / 2 + wallT / 2, h / 2, 0);
    const right = left.clone(); right.position.x *= -1;

    this.root.add(bottom, front, back, left, right);

    // Type-colored rim along the top edge — pure visual cue.
    if (sockType) {
      const rimMat = new THREE.MeshBasicMaterial({ color: typeColor });
      const rimT = 0.004;
      const rimH = 0.006;
      const rimY = h - 0.001;
      const rimFront = new THREE.Mesh(new THREE.BoxGeometry(w + 0.008, rimH, rimT), rimMat);
      rimFront.position.set(0, rimY, d / 2 + 0.002);
      const rimBack = rimFront.clone(); rimBack.position.z *= -1;
      const rimLeft = new THREE.Mesh(new THREE.BoxGeometry(rimT, rimH, d + 0.008), rimMat);
      rimLeft.position.set(-w / 2 - 0.002, rimY, 0);
      const rimRight = rimLeft.clone(); rimRight.position.x *= -1;
      this.root.add(rimFront, rimBack, rimLeft, rimRight);
    }

    // Count label using canvas sprite so the number is readable from any angle.
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    this._countCanvas = canvas;
    this._countCtx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    this._countTex = tex;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.position.set(0, h + 0.05, 0);
    sprite.scale.set(0.16, 0.08, 1);
    this.root.add(sprite);
    this._updateCountLabel();

    this.ui = [
      { type: 'readout', label: '타입', get: () => this._typeLabel || '—' },
      { type: 'slider', label: '수량', param: 'count',
        min: 0, max: capacity, step: 1, format: (v) => `${Math.round(v)}` },
      { type: 'readout', label: '용량', get: () => `${Math.round(this.params.count)} / ${capacity}` },
    ];
  }

  _updateCountLabel() {
    const ctx = this._countCtx;
    const colorHex = '#' + this._typeColor.toString(16).padStart(6, '0');
    ctx.clearRect(0, 0, 128, 64);
    ctx.fillStyle = 'rgba(20,20,24,0.85)';
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 126, 62);
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this._typeLabel) {
      ctx.font = 'bold 18px monospace';
      ctx.fillText(this._typeLabel, 64, 14);
      ctx.font = 'bold 24px monospace';
      ctx.fillText(`${Math.round(this.params.count)}/${this.params.capacity}`, 64, 42);
    } else {
      ctx.font = 'bold 32px monospace';
      ctx.fillText(`${Math.round(this.params.count)}/${this.params.capacity}`, 64, 32);
    }
    this._countTex.needsUpdate = true;
  }

  setParam(name, value) {
    super.setParam(name, value);
    if (name === 'count') this._updateCountLabel();
  }
}
