import * as THREE from 'three';
import { SimObject } from '../domain/SimObject.js';
import { applySocketConveyorCoupling } from './sockets.js';

// ── Tray Stack (acrylic magazine that holds empty trays) ────────────────
// Decorative — a transparent post-frame holding a vertical stack of tray
// plates. The bottom is intentionally open on the +X side so a feeder
// cylinder behind the stack can push the bottom tray out onto a
// conveyor. Count is static (the stack just visualises "trays in stock");
// actual tray spawning on the belt is driven by the cylinder + dispense
// queue in the scenario.
//
// Origin convention: root.y = the surface the stack rests on (table top
// or floor). `mountHeight` raises the bottom tray that far above the
// support so the stack's bottom feed slot lines up with the cylinder
// rod that pushes through it.
export class TrayStack extends SimObject {
  constructor(opts = {}) {
    super('TrayStack');
    const w = opts.width ?? 0.20;
    const d = opts.depth ?? 0.18;
    const count = Math.max(1, Math.min(opts.trayCount ?? 6, 12));
    const mountH = opts.mountHeight ?? 0.06;
    const trayThick = 0.022;
    const trayGap = 0.018;
    const cellH = trayThick + trayGap;

    this.params = {
      width: w, depth: d, trayCount: count, mountHeight: mountH,
    };

    // Transparent acrylic posts span from the support surface (y=0) up
    // through the top of the stack — the section below mountH is the
    // "stilts" that hold the magazine off the table.
    const postTopY = mountH + count * cellH + 0.02;
    const postMat = new THREE.MeshPhongMaterial({
      color: 0xc0e0ff, transparent: true, opacity: 0.30,
      shininess: 100, depthWrite: false,
    });
    const postGeom = new THREE.BoxGeometry(0.006, postTopY, 0.006);
    const corners = [
      [-w/2, -d/2], [+w/2, -d/2],
      [-w/2, +d/2], [+w/2, +d/2],
    ];
    for (const [x, z] of corners) {
      const post = new THREE.Mesh(postGeom, postMat);
      post.position.set(x, postTopY / 2, z);
      post.userData.hasEdgeOverlay = true;
      this.root.add(post);
    }

    // Top frame outline so the magazine reads as a "container".
    const topRing = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.001, d)),
      new THREE.LineBasicMaterial({
        color: 0x88aacc, transparent: true, opacity: 0.7, depthWrite: false,
      }),
    );
    topRing.position.y = postTopY;
    topRing.userData.hasEdgeOverlay = true;
    this.root.add(topRing);

    // Stacked tray plates inside, starting at mountH above the support.
    const trayMat = new THREE.MeshPhongMaterial({
      color: 0x9a7a52, shininess: 30,
      emissive: 0x4a3a20, emissiveIntensity: 0.30,
    });
    const trayGeom = new THREE.BoxGeometry(w * 0.92, trayThick, d * 0.92);
    for (let i = 0; i < count; i++) {
      const t = new THREE.Mesh(trayGeom, trayMat);
      t.position.y = mountH + trayThick / 2 + i * cellH;
      t.userData.hasEdgeOverlay = true;
      this.root.add(t);
    }

    this.ui = [
      { type: 'readout', label: '적재', get: () => `${this.params.trayCount} 장 (장식)` },
    ];
  }
}

// ── Tray (carrier plate that rides the conveyor) ────────────────────────
// A flat plate with N socket slots. The cylinder dispenses an EMPTY tray
// onto Conv1; R1 then loads the tray with sockets per the order. Sockets
// placed on a tray become Three.js children of the tray's root, so they
// move with the tray as the conveyor advances (and applySocketConveyor-
// Coupling skips them so they don't get double-moved).
export class Tray extends SimObject {
  constructor(opts = {}) {
    super('Tray');
    const w = opts.width ?? 0.22;
    const d = opts.depth ?? 0.16;
    const h = 0.022;
    const cap = Math.max(1, Math.min(opts.capacity ?? 4, 6));

    this.params = {
      width: w, depth: d, thickness: h,
      capacity: cap, filled: 0,
    };

    // Marker so socket coupling knows to skip children of this tray.
    this.root.userData.isTrayRoot = true;

    const plateMat = new THREE.MeshPhongMaterial({
      color: 0x9a7a52, shininess: 30,
      emissive: 0x4a3a20, emissiveIntensity: 0.30,
    });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plateMat);
    plate.position.y = h / 2 + 0.005;
    this.root.add(plate);

    // Compute slot grid. cap≤2 → 1 row, otherwise 2 rows.
    this._slots = this._computeSlots(w, d, cap);

    // Slot rings on top so the operator sees where sockets will land.
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd070, transparent: true, opacity: 0.80, depthWrite: false,
    });
    for (const s of this._slots) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.018, 0.022, 16), ringMat,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.x, h + 0.013, s.z);
      ring.userData.isEdgeOverlay = true;
      ring.userData.hasEdgeOverlay = true; // skip auto-edge pass
      this.root.add(ring);
    }

    this.ui = [
      { type: 'readout', label: '용량',
        get: () => `${this.params.filled} / ${this.params.capacity}` },
      { type: 'readout', label: '주문', get: () => this._fromOrder ?? '—' },
    ];
  }

  _computeSlots(w, d, cap) {
    const cols = cap <= 2 ? cap : 2;
    const rows = Math.ceil(cap / cols);
    const out = [];
    const stepX = w / (cols + 1);
    const stepZ = d / (rows + 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols && out.length < cap; c++) {
        out.push({
          x: -w / 2 + stepX * (c + 1),
          z: -d / 2 + stepZ * (r + 1),
        });
      }
    }
    return out;
  }

  // World position above the next free slot (target for IK pick-place).
  // Returns null when full.
  nextEmptySlotWorld(out = new THREE.Vector3()) {
    if (this.params.filled >= this.params.capacity) return null;
    const slot = this._slots[this.params.filled];
    this.root.updateMatrixWorld(true);
    out.set(slot.x, this.params.thickness + 0.020, slot.z);
    out.applyMatrix4(this.root.matrixWorld);
    return out;
  }

  update(dt) { applySocketConveyorCoupling(this, dt); }
}
