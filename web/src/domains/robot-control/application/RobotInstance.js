import * as THREE from 'three';
import { buildGripper, buildPen } from '../infrastructure/three/toolMeshes.js';

let nextRobotInstanceId = 0;

export class RobotInstance {
  constructor({ type, urdf, cfg }) {
    this.id = ++nextRobotInstanceId;
    this.type = type;
    this.cfg = cfg;                          // { chain, tcp }
    this.urdf = urdf;                        // URDFRobot (Object3D)
    this.urdf.userData.robotInstance = this; // for raycast → instance lookup
    this.urdf.name = `robot_${type}_${this.id}`;
    this.sliders = {};                       // { jointName: { input, valLabel } }
    this.gripperGroup = null;
    this.mode = 'manual';                    // per-robot desired mode (currently single global mode drives it)
  }

  setJointValue(name, v) {
    const joint = this.urdf.joints[name];
    if (!joint) return;
    this.urdf.setJointValue(name, v);
    const s = this.sliders[name];
    if (s) {
      s.input.value = v;
      s.valLabel.textContent = (typeof v === 'number' ? v : parseFloat(v)).toFixed(2);
    }
  }

  // Snap immediately to a { jointName: value } target — no animation.
  setPose(angles) {
    for (const [name, v] of Object.entries(angles)) {
      this.setJointValue(name, v);
    }
  }

  // Animate to target pose over `duration` ms. Replaces any in-flight tween.
  // easing: 'easeInOutQuad' (default) for one-shot moves with a polite
  //         start/stop, or 'linear' when this tween is a single segment in
  //         a chained Cartesian path — the ease-out at the boundary stops
  //         the joints momentarily and makes back-to-back tweens look
  //         stuttery, so use linear there for constant-velocity transit.
  animateToPose(angles, duration = 1200, easing = 'easeInOutQuad') {
    const from = {};
    for (const name of Object.keys(angles)) {
      const joint = this.urdf.joints[name];
      if (!joint) continue;
      from[name] = joint.angle ?? 0;
    }
    this._poseAnim = {
      startTime: performance.now(),
      duration: Math.max(50, duration),
      from,
      to: { ...angles },
      easing,
    };
  }

  stepPoseAnim() {
    if (!this._poseAnim) return;
    const t = Math.min((performance.now() - this._poseAnim.startTime) / this._poseAnim.duration, 1);
    const e = this._poseAnim.easing === 'linear'
      ? t
      : (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    for (const [name, target] of Object.entries(this._poseAnim.to)) {
      const start = this._poseAnim.from[name];
      if (start === undefined) continue;
      this.setJointValue(name, start + (target - start) * e);
    }
    if (t >= 1) this._poseAnim = null;
  }

  // World-frame position of the URDF's TCP link, regardless of whether a
  // tool is attached. Useful for trajectory planning that needs to know
  // where the robot's end-effector is right now.
  getTcpWorld(out = new THREE.Vector3()) {
    const tcpLink = this.urdf.links[this.cfg.tcp];
    if (!tcpLink) return null;
    tcpLink.updateMatrixWorld(true);
    return out.setFromMatrixPosition(tcpLink.matrixWorld);
  }

  resetJoints() {
    for (const name of Object.keys(this.urdf.joints)) {
      const joint = this.urdf.joints[name];
      if (joint.jointType === 'fixed' || joint.jointType === 'unknown') continue;
      this.setJointValue(name, 0);
    }
  }

  // ── Tools (gripper / pen) attach/detach ─────────────────────────────
  attachGripper() {
    if (this.gripperGroup) return this.gripperGroup;
    this.detachPen();   // tools are mutually exclusive
    const anchor = this.cfg.tcp ? this.urdf.links[this.cfg.tcp] : null;
    if (!anchor) { console.warn('[Robot] no TCP link for', this.type); return null; }
    this.gripperGroup = buildGripper();
    anchor.add(this.gripperGroup);
    return this.gripperGroup;
  }

  detachGripper() {
    const g = this.gripperGroup;
    if (!g) return;
    if (this.heldSocket) this.releaseSocket(this.heldSocket);
    if (g.parent) g.parent.remove(g);
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.gripperGroup = null;
  }

  attachPen() {
    if (this.penGroup) return this.penGroup;
    this.detachGripper();   // mutually exclusive with gripper
    const anchor = this.cfg.tcp ? this.urdf.links[this.cfg.tcp] : null;
    if (!anchor) { console.warn('[Robot] no TCP link for', this.type); return null; }
    this.penGroup = buildPen();
    anchor.add(this.penGroup);
    return this.penGroup;
  }

  detachPen() {
    const p = this.penGroup;
    if (!p) return;
    if (p.parent) p.parent.remove(p);
    p.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.penGroup = null;
  }

  // World position of the active tool's drawing/hold point. Returns null
  // if no tool is attached. Used by the trail renderer.
  getToolTipWorld(out = new THREE.Vector3()) {
    const tool = this.penGroup ?? this.gripperGroup;
    if (!tool) return null;
    tool.updateMatrixWorld(true);
    const local = tool.userData.tipPoint ?? tool.userData.holdPoint;
    if (!local) return null;
    return out.copy(local).applyMatrix4(tool.matrixWorld);
  }

  setGripperOpening(m) {
    this.gripperGroup?.setOpening?.(m);
    this._gripperOpening = m;
  }

  // Pneumatic-style smooth open/close. Snappier than the joint tween — real
  // pneumatic grippers actuate in 200–400ms.
  animateGripperTo(targetOpening, duration = 350) {
    if (!this.gripperGroup) return;
    const from = this._gripperOpening ?? 0.04;
    this._gripAnim = {
      startTime: performance.now(),
      duration: Math.max(50, duration),
      from,
      to: targetOpening,
    };
  }
  closeGripper(duration = 350) { this.animateGripperTo(0.005, duration); }
  openGripper(duration = 350)  { this.animateGripperTo(0.040, duration); }

  stepGripperAnim() {
    if (!this._gripAnim) return;
    const t = Math.min((performance.now() - this._gripAnim.startTime) / this._gripAnim.duration, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const v = this._gripAnim.from + (this._gripAnim.to - this._gripAnim.from) * e;
    this.setGripperOpening(v);
    if (t >= 1) this._gripAnim = null;
  }

  // ── Socket pick / release (kinematic, no physics) ───────────────────
  // pickSocket re-parents `socket.root` under this gripper so the socket
  // tracks the arm's motion. releaseSocket re-parents back to the scene
  // and freezes its world position there.
  // Re-parent the socket under the gripper. Does NOT animate the jaws —
  // the work cycle calls closeGripper() separately so the visual is "jaws
  // close, then load is captured" instead of magic-snap.
  pickSocket(socket) {
    if (!this.gripperGroup || !socket) return false;
    if (socket._pickedBy) return false;
    if (this.heldSocket) return false;
    const hold = this.gripperGroup.userData.holdPoint;
    this.gripperGroup.add(socket.root);
    socket.root.position.copy(hold);
    socket.root.rotation.set(0, 0, 0);
    socket.root.scale.set(1, 1, 1);
    socket._pickedBy = this;
    this.heldSocket = socket;
    return true;
  }

  releaseSocket(socket = this.heldSocket, sceneOverride = null) {
    if (!socket || socket._pickedBy !== this) return;
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    socket.root.getWorldPosition(wp);
    socket.root.getWorldQuaternion(wq);
    let scene = sceneOverride || socket.root.parent;
    while (scene && scene.parent) scene = scene.parent;
    if (!scene) return;
    scene.add(socket.root);
    socket.root.position.copy(wp);
    socket.root.quaternion.copy(wq);
    socket._pickedBy = null;
    if (this.heldSocket === socket) this.heldSocket = null;
  }

  dispose(scene) {
    scene.remove(this.urdf);
    this.urdf.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}
