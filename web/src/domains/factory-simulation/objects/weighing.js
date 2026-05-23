import * as THREE from 'three';
import { SimObject } from '../domain/SimObject.js';

// ── Weight Scale ────────────────────────────────────────────────────────
// Detects sockets sitting on its top surface, sums their per-type weights,
// and reports whether actual weight is within tolerance of the expected
// value. `complete` is a boolean output suitable for OPC UA write binding.
export class WeightScale extends SimObject {
  constructor(opts = {}) {
    super('WeightScale');
    const platSize = opts.size ?? 0.18;
    const platHeight = opts.height ?? 0.06;

    this.params = {
      expectedWeight: 0,
      actualWeight: 0,
      complete: false,
      tolerance: opts.tolerance ?? 5,
      socket8Weight: opts.socket8Weight ?? 50,
      socket12Weight: opts.socket12Weight ?? 75,
      detectedCount: 0,
      platSize,
      platHeight,
    };

    const baseMat = new THREE.MeshPhongMaterial({ color: 0x4a5260, shininess: 60 });
    const platMat = new THREE.MeshPhongMaterial({ color: 0xc8c8d0, shininess: 100 });
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(platSize * 1.1, platHeight * 0.5, platSize * 1.1),
      baseMat,
    );
    housing.position.y = platHeight * 0.25;
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(platSize, 0.008, platSize),
      platMat,
    );
    platform.position.y = platHeight * 0.5 + 0.004;
    this._platTopY = platform.position.y + 0.004;

    const canvas = document.createElement('canvas');
    canvas.width = 192; canvas.height = 64;
    this._dispCanvas = canvas;
    this._dispCtx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    this._dispTex = tex;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.position.set(0, platHeight * 0.5 + 0.06, platSize * 0.55);
    sprite.scale.set(0.18, 0.06, 1);
    this.root.add(housing, platform, sprite);
    this._updateDisplay();

    this.ui = [
      { type: 'slider', label: '예상 무게 (g)', param: 'expectedWeight',
        min: 0, max: 1000, step: 5, format: (v) => `${Math.round(v)}` },
      { type: 'slider', label: '8핀 단위 무게 (g)', param: 'socket8Weight',
        min: 10, max: 200, step: 1, format: (v) => `${Math.round(v)}` },
      { type: 'slider', label: '12핀 단위 무게 (g)', param: 'socket12Weight',
        min: 10, max: 200, step: 1, format: (v) => `${Math.round(v)}` },
      { type: 'readout', label: '측정 무게', get: () => `${Math.round(this.params.actualWeight)} g` },
      { type: 'readout', label: '감지 개수', get: () => `${this.params.detectedCount} 개` },
      { type: 'readout', label: '판정', get: () => {
        if (this.params.expectedWeight === 0) return '— (예상 무게 미설정)';
        return this.params.complete ? '✓ 정량' : '✗ 불일치';
      }},
      { type: 'opcuaBinding', direction: 'write', paramName: 'complete' },
    ];
    this.opcua.paramName = 'complete';

    this._tmpScalePos = new THREE.Vector3();
    this._tmpSocketPos = new THREE.Vector3();
  }

  _updateDisplay() {
    const ctx = this._dispCtx;
    ctx.clearRect(0, 0, 192, 64);
    ctx.fillStyle = 'rgba(15,15,18,0.92)';
    ctx.fillRect(0, 0, 192, 64);
    ctx.strokeStyle = '#ff9a5a';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 190, 62);
    const w = Math.round(this.params.actualWeight);
    const exp = Math.round(this.params.expectedWeight);
    const ok = exp > 0 && this.params.complete;
    ctx.fillStyle = ok ? '#22e090' : (exp > 0 ? '#ff5a3a' : '#ff9a5a');
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${w} / ${exp} g`, 96, 32);
    this._dispTex.needsUpdate = true;
  }

  update(_dt) {
    if (!this.registry) return;
    this.root.getWorldPosition(this._tmpScalePos);
    const half = this.params.platSize / 2;
    const topY = this._tmpScalePos.y + this._platTopY;
    let weight = 0;
    let count = 0;
    const sockets = this.registry.getObjectsByTypes(['8핀소켓', '12핀소켓']);
    for (const s of sockets) {
      s.root.getWorldPosition(this._tmpSocketPos);
      const dx = this._tmpSocketPos.x - this._tmpScalePos.x;
      const dz = this._tmpSocketPos.z - this._tmpScalePos.z;
      const dy = this._tmpSocketPos.y - topY;
      if (Math.abs(dx) < half && Math.abs(dz) < half && dy > -0.02 && dy < 0.12) {
        weight += s.type === '8핀소켓' ? this.params.socket8Weight : this.params.socket12Weight;
        count += 1;
      }
    }
    this.params.actualWeight = weight;
    this.params.detectedCount = count;
    const exp = this.params.expectedWeight;
    this.params.complete = exp > 0 && Math.abs(weight - exp) <= this.params.tolerance;
    this._updateDisplay();
  }
}
