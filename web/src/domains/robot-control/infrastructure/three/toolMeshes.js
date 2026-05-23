import * as THREE from 'three';
import { addEdgesOverlay } from '../../../../infrastructure/three/addEdgesOverlay.js';

// ── Procedural pen tool ────────────────────────────────────────────────
// Slim cylindrical pen with a black tip pointing along TCP +Z. The
// tipPoint userData is the world-traceable point; Trail renderer samples
// it each frame to draw the path through the air.
export function buildPen() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0xff5a5a, shininess: 80 });
  const tipMat = new THREE.MeshPhongMaterial({ color: 0x111114, shininess: 120 });
  const grip = new THREE.MeshPhongMaterial({ color: 0x333339, shininess: 40 });

  // Grip flange where it attaches to TCP
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16), grip);
  flange.rotation.x = Math.PI / 2;
  flange.position.z = 0.006;
  g.add(flange);

  // Pen body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.075, 14), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.05;
  g.add(body);

  // Conical tip
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 14), tipMat);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = 0.098;
  g.add(tip);

  // World-traceable tip in local frame (very end of the cone).
  g.userData.tipPoint = new THREE.Vector3(0, 0, 0.108);
  addEdgesOverlay(g);
  return g;
}

// ── Procedural parallel-jaw gripper ─────────────────────────────────────
// Built once per robot, attached as child of TCP link. setOpening(m) moves
// the two finger pivots symmetrically along ±X.
export function buildGripper() {
  const g = new THREE.Group();
  const metal = new THREE.MeshPhongMaterial({ color: 0xff9a5a, specular: 0x664433, shininess: 80 });
  const pad = new THREE.MeshPhongMaterial({ color: 0xfff0dd, shininess: 30 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 24), metal);
  base.rotation.x = Math.PI / 2;
  base.position.z = 0.01;
  g.add(base);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.06), metal);
  body.position.z = 0.05;
  g.add(body);

  const fingerL = new THREE.Group();
  const fingerR = new THREE.Group();
  fingerL.position.set(0, 0, 0.08);
  fingerR.position.set(0, 0, 0.08);
  g.add(fingerL, fingerR);

  const finger = new THREE.BoxGeometry(0.012, 0.04, 0.06);
  const meshL = new THREE.Mesh(finger, pad);
  meshL.position.z = 0.03;
  fingerL.add(meshL);
  const meshR = new THREE.Mesh(finger, pad);
  meshR.position.z = 0.03;
  fingerR.add(meshR);

  g.userData = { fingerL, fingerR };
  g.setOpening = (m) => {
    const half = m / 2;
    fingerL.position.x = -half - 0.008;
    fingerR.position.x = half + 0.008;
  };
  g.setOpening(0.04);
  // Anchor point for held items: midway between the two fingertips.
  g.userData.holdPoint = new THREE.Vector3(0, 0, 0.10);
  addEdgesOverlay(g);
  return g;
}
