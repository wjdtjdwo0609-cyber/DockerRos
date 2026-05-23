// Real-line mirror: applies sensor_msgs/JointState frames onto sim robots.
//
// Two policies coexist:
//   • per-robot (/<cid>/joint_states) drives exactly the arm tagged with
//     that cid (set by loadFactoryScenario). Each frame stamps
//     mirrorActive[cid] so other systems can tell the live stream is fresh.
//   • shared /joint_states is the back-compat path for single-robot or
//     untagged scenes. Untagged arms only — tagged arms (r1/r2/r3) ignore
//     it so the two streams never fight.
//
// rosbridge connection itself stays in the composition root (app.js)
// because it owns the DOM bindings (connect/disconnect buttons +
// status label).

const MIRROR_FRESH_MS = 1500;

export function createRosJointMirror({ robotManager }) {
  const mirrorActive = {};   // cid → last-frame timestamp (ms)

  function applyJointState(robot, msg) {
    for (let i = 0; i < msg.name.length; i++) {
      if (robot.urdf.joints[msg.name[i]]) {
        robot.setJointValue(msg.name[i], msg.position[i]);
      }
    }
  }

  // Per-robot stream handler. `cid` is the robot tag baked in by
  // loadFactoryScenario (r1 / r2 / r3).
  function handleTaggedFrame(cid, msg) {
    const target = robotManager.getAll()
      .find((r) => r.urdf.userData && r.urdf.userData.cid === cid);
    if (!target) return;
    applyJointState(target, msg);
    mirrorActive[cid] = Date.now();
  }

  // Shared /joint_states handler. Tagged arms (r1/r2/r3) are skipped —
  // otherwise the brief gaps in per-robot streams would let `shared` snap
  // the pose backwards.
  function handleSharedFrame(msg) {
    for (const r of robotManager.getAll()) {
      const cid = r.urdf.userData && r.urdf.userData.cid;
      if (cid) continue;
      applyJointState(r, msg);
    }
  }

  function isAnyActive() {
    const now = Date.now();
    return Object.values(mirrorActive).some((t) => now - t < MIRROR_FRESH_MS);
  }

  return {
    applyJointState,
    handleTaggedFrame,
    handleSharedFrame,
    isAnyActive,
  };
}
