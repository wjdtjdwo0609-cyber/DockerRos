import * as THREE from 'three';
import { SimObject } from '../domain/SimObject.js';

// ── Socket parts (8-pin / 12-pin connectors) ────────────────────────────
// Kinematic coupling: if a socket sits on top of any RUNNING conveyor, slide
// it along the conveyor's local +X at the conveyor's current speed. Belt
// surface heuristic: y in [0.18, 0.28] in conveyor local frame (legHeight
// 0.18 + thickness ~0.02, with a ~0.05 tolerance for sockets on top).
const _socketTmpInv = new THREE.Matrix4();
const _socketTmpLocal = new THREE.Vector3();
const _socketTmpFwd = new THREE.Vector3();
export function applySocketConveyorCoupling(socket, dt) {
  if (!socket.registry) return;
  // Gripper-held sockets: the robot drives the motion via re-parenting,
  // so don't double-move them on the conveyor.
  if (socket._pickedBy) return;
  // Sockets riding on a tray are children of the tray's root; the tray's
  // own coupling moves the parent and the socket follows via scene graph.
  if (socket.root.parent?.userData?.isTrayRoot) return;
  for (const c of socket.registry.getObjectsByType('Conveyor')) {
    const speed = c.params.running ? c.params.speed : 0;
    if (speed === 0) continue;
    // matrixWorld is only refreshed during render; force it now so the
    // sim works regardless of frame timing or whether a render happened.
    c.root.updateMatrixWorld();
    _socketTmpInv.copy(c.root.matrixWorld).invert();
    _socketTmpLocal.copy(socket.root.position).applyMatrix4(_socketTmpInv);
    const halfL = c.params.length / 2;
    const halfW = c.params.width / 2;
    if (Math.abs(_socketTmpLocal.x) < halfL &&
        Math.abs(_socketTmpLocal.z) < halfW &&
        _socketTmpLocal.y > 0.17 && _socketTmpLocal.y < 0.28) {
      _socketTmpFwd.set(1, 0, 0).applyQuaternion(c.root.quaternion);
      socket.root.position.addScaledVector(_socketTmpFwd, speed * dt);
      return;
    }
  }
}

function _buildSocketMesh(root, pinCount, bodyWidth, socket) {
  // Enlarged dimensions + a bright type-coded halo so sockets read clearly
  // against the dark factory floor and the operator can see what's being
  // grabbed from any camera angle.
  const bodyH = 0.018;
  const bodyD = 0.022;
  const tagColor = pinCount === 8 ? 0xff9a5a : 0x5aa7ff; // orange / blue
  // Body uses a darker tinted version of the type color (instead of plain
  // dark grey) so 8핀 vs 12핀 reads even from top-down views where the
  // halo is edge-on. ~30% mix toward black keeps the surface readable.
  const bodyTint = pinCount === 8 ? 0x4d2f1b : 0x1b314d;

  const bodyMat = new THREE.MeshPhongMaterial({
    color: bodyTint,
    emissive: tagColor,
    emissiveIntensity: 0.35,
    shininess: 30,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyWidth, bodyH, bodyD), bodyMat);
  body.position.y = bodyH / 2 + 0.005;

  // Bright wireframe halo around the body — visible across the room.
  const haloGeom = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(bodyWidth + 0.004, bodyH + 0.004, bodyD + 0.004),
  );
  const haloMat = new THREE.LineBasicMaterial({
    color: tagColor, transparent: true, opacity: 0.95, depthWrite: false,
  });
  const halo = new THREE.LineSegments(haloGeom, haloMat);
  halo.position.y = body.position.y;
  halo.userData.isEdgeOverlay = true; // skip the auto-edge pass
  root.add(halo);

  // Floating indicator dot above the socket — readable from above (top
  // vision camera, top preset, etc.) where the body might be edge-on.
  const dotMat = new THREE.MeshBasicMaterial({ color: tagColor, depthWrite: false });
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 14, 10),
    dotMat,
  );
  dot.position.y = body.position.y + bodyH + 0.018;
  dot.userData.isEdgeOverlay = true;
  root.add(dot);

  // Defective marker: a red ✕ floating on top of the socket. Hidden by
  // default; toggled visible by Socket8/12.setParam('defective', true).
  // Mark the meshes (NOT the group) with hasEdgeOverlay=true so the
  // automatic mesh edge-overlay pass in addEdgesOverlay() skips them —
  // the cross is already a small visual cue and wireframe edges on its
  // arms add clutter without information. The select-highlight traversal
  // checks isEdgeOverlay (which we don't set), so it leaves these alone.
  const xMat = new THREE.MeshBasicMaterial({ color: 0xff1a33, depthWrite: false });
  const armLen = bodyWidth * 0.85;
  const armGeom = new THREE.BoxGeometry(armLen, 0.0035, 0.0035);
  const armA = new THREE.Mesh(armGeom, xMat);
  const armB = new THREE.Mesh(armGeom, xMat);
  armA.rotation.y =  Math.PI / 4;
  armB.rotation.y = -Math.PI / 4;
  armA.userData.hasEdgeOverlay = true;
  armB.userData.hasEdgeOverlay = true;
  const xMark = new THREE.Group();
  xMark.add(armA, armB);
  xMark.position.y = body.position.y + bodyH + 0.005;
  xMark.visible = false;
  root.add(xMark);

  socket._styleHandles = { tagColor, bodyMat, haloMat, dotMat, xMark, xMat };

  const pinMat = new THREE.MeshPhongMaterial({ color: 0xd4a854, shininess: 100 });
  const pinsPerRow = pinCount / 2;
  const rowZ = bodyD * 0.25;
  const startX = -bodyWidth * 0.5 + bodyWidth / (pinsPerRow + 1);
  const stepX = bodyWidth / (pinsPerRow + 1);
  const pinGeom = new THREE.CylinderGeometry(0.002, 0.002, 0.010, 8);
  for (let r = 0; r < 2; r++) {
    for (let p = 0; p < pinsPerRow; p++) {
      const pin = new THREE.Mesh(pinGeom, pinMat);
      pin.position.set(startX + p * stepX, 0.005, r === 0 ? rowZ : -rowZ);
      root.add(pin);
    }
  }
  root.add(body);
}

// Shared visual update: red emissive + red halo + visible ✕ when defective,
// otherwise restore the type-color (orange for 8pin, blue for 12pin).
function _applySocketDefectiveStyle(socket) {
  const h = socket._styleHandles;
  if (!h) return;
  const def = !!socket.params.defective;
  const color = def ? 0xff2a3d : h.tagColor;
  h.bodyMat.emissive.setHex(color);
  h.bodyMat.emissiveIntensity = def ? 0.50 : 0.35;
  h.haloMat.color.setHex(color);
  h.dotMat.color.setHex(color);
  h.xMark.visible = def;
}

export class Socket8 extends SimObject {
  constructor(opts = {}) {
    super('8핀소켓');
    this.params = { pinCount: 8, defective: !!opts.defective };
    _buildSocketMesh(this.root, 8, 0.04, this);
    _applySocketDefectiveStyle(this);
    this.ui = [
      { type: 'readout', label: '핀 수', get: () => '8핀' },
      { type: 'toggle', label: '불량품', param: 'defective' },
      { type: 'readout', label: '월드 위치', get: () => {
        const p = new THREE.Vector3();
        this.root.getWorldPosition(p);
        return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
      }},
    ];
  }
  setParam(name, value) {
    super.setParam(name, value);
    if (name === 'defective') _applySocketDefectiveStyle(this);
  }
  update(dt) { applySocketConveyorCoupling(this, dt); }
}

export class Socket12 extends SimObject {
  constructor(opts = {}) {
    super('12핀소켓');
    this.params = { pinCount: 12, defective: !!opts.defective };
    _buildSocketMesh(this.root, 12, 0.06, this);
    _applySocketDefectiveStyle(this);
    this.ui = [
      { type: 'readout', label: '핀 수', get: () => '12핀' },
      { type: 'toggle', label: '불량품', param: 'defective' },
      { type: 'readout', label: '월드 위치', get: () => {
        const p = new THREE.Vector3();
        this.root.getWorldPosition(p);
        return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
      }},
    ];
  }
  setParam(name, value) {
    super.setParam(name, value);
    if (name === 'defective') _applySocketDefectiveStyle(this);
  }
  update(dt) { applySocketConveyorCoupling(this, dt); }
}
