// Welding test (homework 정답 시퀀스). Runs the exact joint sequence from
// the 5-problem template — home → p1 → 3× (p1 → p2 → p_mid → p3 → p4 →
// p1) → home — converted from degrees to radians. Joint name mapping is
// robot-aware: the homework's 6-element angle array is applied to the
// first 6 joints of `robot.cfg.chain`, so it works on Indy7, Indy12
// (joint0~joint5), UR5e/UR10e (shoulder_pan_joint…), Panda
// (panda_joint1~7, 7th held at 0), and Fanuc (joint_1~6).

const D2R = Math.PI / 180;

function angDegForRobot(robot, arr) {
  const out = {};
  const chain = robot.cfg?.chain ?? [];
  for (let i = 0; i < arr.length && i < chain.length; i++) {
    out[chain[i]] = arr[i] * D2R;
  }
  // Any extra joints (e.g. Panda's 7th) are explicitly held at 0 so
  // animateToPose tweens them rather than leaving them drifting.
  for (let i = arr.length; i < chain.length; i++) {
    out[chain[i]] = 0;
  }
  return out;
}

export async function runWeldingTest(robot, opts = {}) {
  if (!robot) return;
  const log = opts.log ?? console.log;
  const signal = opts.signal;

  // Throws AbortError when the caller signals cancellation. Used at each
  // await boundary so a stop request takes effect at the next phase.
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const e = new Error('aborted'); e.name = 'AbortError'; throw e;
    }
  };
  // Abortable sleep: rejects with AbortError if signal fires mid-wait.
  const wait = (ms) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e); return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
    }, { once: true });
  });
  const moveTo = async (pose, animMs, sleepSec) => {
    throwIfAborted();
    robot.animateToPose(pose, animMs);
    await wait(animMs + sleepSec * 1000);
  };
  const ang = (arr) => angDegForRobot(robot, arr);

  // Same values as the homework template (degrees). Mapped onto whatever
  // 6-DOF chain the active robot exposes via cfg.chain.
  const home_pose = ang([0, 30, -60, 0, 30, 0]);
  const welding_depth = -50;
  const p_mid = ang([-5, 45, -25, 0, 70, 0]);
  const p1 = ang([-10, 50, welding_depth, 0, 70, 0]);
  const p2 = ang([ 10, 50, welding_depth, 0, 70, 0]);
  const p3 = ang([ 15, 60, -40,            0, 70, 0]);
  const p4 = ang([-15, 60, -40,            0, 70, 0]);

  log(`▶ 용접 준비 위치로 이동 (${robot.type})`);
  await moveTo(home_pose, 1500, 1.5);
  await moveTo(p1,        1000, 1.0);

  for (let i = 0; i < 3; i++) {
    log(` 용접 사이클 ${i + 1}/3 시작`);
    await moveTo(p1,    1000, 2.5);
    await moveTo(p2,     800, 0.5);
    await moveTo(p_mid,  800, 0.5);
    await moveTo(p3,     800, 0.5);
    await moveTo(p4,     800, 0.5);
    await moveTo(p1,     800, 0.5);
  }

  log('▶ 홈으로 복귀');
  await moveTo(home_pose, 1500, 0);
}
