import * as THREE from 'three';
import { unwrapValueFrom, unwrapPoseFrom } from './poseMath.js';

export { unwrapPoseFrom };

// CCD solver run "in place" against a robot's URDF chain. Returns the
// resulting joint angles WITHOUT leaving the robot disturbed.
export function planIKToTarget(robot, worldTarget, opts = {}) {
  const iterations = opts.iterations ?? 150;
  const damping = opts.damping ?? 0.45;
  const dampingPerJoint = opts.dampingPerJoint ?? null;
  const locked = new Set(opts.lockJoints ?? []);
  const { urdf, cfg } = robot;
  const fullChain = cfg.chain.map((name) => urdf.joints[name]).filter(Boolean);
  const activeChain = fullChain.filter((joint) => !locked.has(joint.name));
  const tcp = urdf.links[cfg.tcp];
  if (!tcp || activeChain.length === 0) return null;

  const saved = {};
  for (const joint of fullChain) saved[joint.name] = joint.angle ?? 0;

  if (opts.startPose) {
    for (const [name, value] of Object.entries(opts.startPose)) {
      if (urdf.joints[name]) urdf.setJointValue(name, value);
    }
  }

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  for (let iteration = 0; iteration < iterations; iteration++) {
    let maxStep = 0;
    for (let index = activeChain.length - 1; index >= 0; index--) {
      const joint = activeChain[index];
      joint.updateMatrixWorld(true);
      tcp.updateMatrixWorld(true);
      const jointPos = tmpA.setFromMatrixPosition(joint.matrixWorld);
      const tcpPos = new THREE.Vector3().setFromMatrixPosition(tcp.matrixWorld);
      const toEnd = new THREE.Vector3().subVectors(tcpPos, jointPos);
      const toTarget = new THREE.Vector3().subVectors(worldTarget, jointPos);
      if (toEnd.lengthSq() < 1e-9 || toTarget.lengthSq() < 1e-9) continue;
      toEnd.normalize();
      toTarget.normalize();
      const axisWorld = new THREE.Vector3().crossVectors(toEnd, toTarget);
      if (axisWorld.lengthSq() < 1e-9) continue;
      axisWorld.normalize();
      const jointDamping = dampingPerJoint?.[joint.name] ?? damping;
      const angle = Math.acos(THREE.MathUtils.clamp(toEnd.dot(toTarget), -1, 1)) * jointDamping;
      const jointAxisWorld = tmpB.set(joint.axis.x, joint.axis.y, joint.axis.z)
        .transformDirection(joint.parent.matrixWorld);
      const signedAngle = angle * axisWorld.dot(jointAxisWorld);
      let newValue = (joint.angle ?? 0) + signedAngle;
      if (Number.isFinite(joint.limit.lower) && Number.isFinite(joint.limit.upper)) {
        newValue = THREE.MathUtils.clamp(newValue, joint.limit.lower, joint.limit.upper);
      }
      urdf.setJointValue(joint.name, newValue);
      maxStep = Math.max(maxStep, Math.abs(signedAngle));
    }
    if (maxStep < 1e-5) break;
  }

  const solved = {};
  for (const joint of fullChain) solved[joint.name] = joint.angle ?? 0;
  tcp.updateMatrixWorld(true);
  const finalTcp = new THREE.Vector3().setFromMatrixPosition(tcp.matrixWorld);
  const error = finalTcp.distanceTo(worldTarget);

  for (const [name, value] of Object.entries(saved)) urdf.setJointValue(name, value);

  if (error > 0.05) {
    console.warn('[planIK] target unreachable, error =', error.toFixed(3),
      'm at', worldTarget.toArray().map((value) => value.toFixed(2)).join(','));
  }
  return solved;
}

export function planChain(robot, worldTargets, opts = {}) {
  const lockJoints = opts.lockJoints ?? [];
  const startPose = opts.startPose ?? {};
  const iterations = opts.iterations ?? 150;
  const damping = opts.damping ?? 0.45;

  let previous = { ...startPose };
  const results = [];
  for (const target of worldTargets) {
    const result = planIKToTarget(robot, target, { startPose: previous, lockJoints, iterations, damping });
    if (!result) return null;
    for (const name of Object.keys(result)) {
      result[name] = unwrapValueFrom(result[name], previous[name] ?? 0);
    }
    results.push(result);
    previous = result;
  }
  return results;
}
