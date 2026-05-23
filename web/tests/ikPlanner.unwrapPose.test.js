// Pure-math tests for poseMath helpers.
// (planIKToTarget / planChain in ikPlanner.js need a live URDF robot and are
// integration-tested in the browser, not here.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapPoseFrom, unwrapValueFrom } from '../src/domains/robot-control/domain/poseMath.js';

const PI = Math.PI;

test('returns identical values when within ±π of from-pose', () => {
  const target = { j0: 0.1, j1: -0.5 };
  const from = { j0: 0, j1: 0 };
  assert.deepEqual(unwrapPoseFrom(target, from), { j0: 0.1, j1: -0.5 });
});

test('unwraps by -2π when target is more than π above from-pose', () => {
  // from=0, target=π+0.1 → should resolve to π+0.1 - 2π = -π+0.1
  const out = unwrapPoseFrom({ j0: PI + 0.1 }, { j0: 0 });
  assert.ok(Math.abs(out.j0 - (-PI + 0.1)) < 1e-12, `got ${out.j0}`);
});

test('unwraps by +2π when target is more than π below from-pose', () => {
  // from=0, target=-π-0.1 → should resolve to π-0.1
  const out = unwrapPoseFrom({ j0: -PI - 0.1 }, { j0: 0 });
  assert.ok(Math.abs(out.j0 - (PI - 0.1)) < 1e-12, `got ${out.j0}`);
});

test('treats missing from-pose joints as zero', () => {
  const out = unwrapPoseFrom({ j0: PI + 0.1 }, {});
  assert.ok(Math.abs(out.j0 - (-PI + 0.1)) < 1e-12);
});

test('handles multiple joints independently', () => {
  const target = { j0: PI + 0.1, j1: 0.2, j2: -PI - 0.3 };
  const from = { j0: 0, j1: 0, j2: 0 };
  const out = unwrapPoseFrom(target, from);
  assert.ok(Math.abs(out.j0 - (-PI + 0.1)) < 1e-12);
  assert.equal(out.j1, 0.2);
  assert.ok(Math.abs(out.j2 - (PI - 0.3)) < 1e-12);
});

test('large multi-wrap distances unwrap to nearest equivalent', () => {
  // from=0, target=3π → loops down to π (one 2π subtraction lands at π, which
  // is the boundary; the loop's strict > condition stops there).
  const out = unwrapPoseFrom({ j0: 3 * PI }, { j0: 0 });
  assert.ok(Math.abs(out.j0 - PI) < 1e-12, `got ${out.j0}`);
});
