// Pure pose / joint-angle math. No three.js, no DOM — testable in plain node.

const PI = Math.PI;
const TWO_PI = 2 * PI;

// Shift `value` by ±2π until it lands within (from-π, from+π]. Used to keep
// solved IK joint angles continuous frame-to-frame instead of teleporting
// across a wrap.
export function unwrapValueFrom(value, from) {
  let v = value;
  while (v - from > PI) v -= TWO_PI;
  while (v - from < -PI) v += TWO_PI;
  return v;
}

// Apply unwrapValueFrom to every joint in a pose object. Missing entries in
// `fromPose` are treated as 0.
export function unwrapPoseFrom(targetPose, fromPose) {
  const out = {};
  for (const [name, value] of Object.entries(targetPose)) {
    out[name] = unwrapValueFrom(value, fromPose[name] ?? 0);
  }
  return out;
}
