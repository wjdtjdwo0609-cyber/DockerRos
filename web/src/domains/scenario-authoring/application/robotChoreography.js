// Per-robot pick-place sequences for the 3-robot socket sorting line.
//
//   R1 — loadTraySequence     : magazine pick → place on Conv1 tray (replay)
//   R2 — defectRejectSequence : Conv2 socket → reject bin (replay)
//   R3 — weighAndSortSequence : tray socket → scale → dispatch bin (replay)
//   *  — pickPlaceSequence    : generic IK-driven pick & place
//
// All four return the total scheduled duration (ms). The "replay"
// sequences use captured Indy7 poses from the operator slider demo —
// they reproduce that choreography exactly, so each cycle looks identical
// frame-for-frame instead of drifting based on IK convergence.

import * as THREE from 'three';
import { planChain, unwrapPoseFrom } from '../../robot-control/index.js';
import {
  HOME_POSE,
  POSE_R2_REPLAY_OVER_PICK, POSE_R2_REPLAY_AT_PICK,
  POSE_R2_REPLAY_LIFT,
  POSE_R2_REPLAY_OVER_PLACE, POSE_R2_REPLAY_AT_PLACE,
  POSE_R3_REPLAY_OVER_A, POSE_R3_REPLAY_AT_A,
  POSE_R3_REPLAY_OVER_B, POSE_R3_REPLAY_AT_B,
  POSE_R3_REPLAY_OVER_C, POSE_R3_REPLAY_AT_C,
} from '../domain/poses.js';

// ── Geometry constants ───────────────────────────────────────────────────
// Vertical clearance: how high above the target the gripper hovers before
// descending. Larger = more "industrial" approach but slower cycle.
const APPROACH_LIFT = 0.10;
// The gripper extends ~10 cm beyond TCP (its hold point lives at local
// (0,0,0.10)). When commanding TCP via IK, target = world-pick-position
// minus this offset along the gripper's approach axis. We use world +Y
// (gripper coming down from above) so target_TCP = pick_world + Y*hold.
const HOLD_OFFSET = 0.10;

// TCP target = item world position + HOLD_OFFSET (gripper hangs 10 cm
// below TCP) + extraLift (approach/depart vertical clearance). Pass
// extraLift=0 for the "at" pose, or a larger value to clear obstacles
// (e.g. 0.20 m to fly the gripper above the elevator's cage top).
function tcpTargetAt(itemWorldPos, extraLift = 0) {
  return new THREE.Vector3(
    itemWorldPos.x,
    itemWorldPos.y + HOLD_OFFSET + extraLift,
    itemWorldPos.z,
  );
}

// ── Industrial-style pick-and-place phase durations (ms) ────────────────
const D_TRAVEL  = 1500; // long lateral move (over_pick → over_place)
const D_DESCEND =  900; // approach descent (over → at), slow for accuracy
const D_LIFT    =  650; // depart ascent (at → over)
const D_HOME    =  900; // return-home
const D_GRIP    =  300; // pneumatic close/open time
const D_SETTLE  =  120; // settle pause between waypoints
const D_HOLD_AFTER_GRIP = 100; // brief grip-hold before lifting

// ── R1 magazine pick replay constants ───────────────────────────────────
// Magazine pickup positions for each socket type. R1 picks here, then
// places on the next free tray slot. Boxes share the table's X
// (-1.85) and stagger along Z; the magazine ejects each socket at the
// box top (~0.30 + small offset).
const MAGAZINE_PICK = {
  Socket8:  new THREE.Vector3(-1.85, 0.31, -0.10),
  Socket12: new THREE.Vector3(-1.85, 0.31,  0.10),
};

// R1 pose templates derived from manual operator demonstration. Each
// pose only varies joint0 (base yaw) and joint1/2 (shoulder/elbow);
// joint3-5 stay at HOME so the wrist never twists. The captured values
// represent the minimum-motion path the operator drew with the sliders:
//   "rotate base, slight dip, lift, rotate base, slight dip, release."
// joint0 differs per box because the magazine slots are at different Z
// (8핀 z=-0.10, 12핀 z=+0.10).
const PI_2 = Math.PI / 2;
const R1_JOINT0 = {
  Socket8:  -2.81,   // magazine box at x=-1.85, z=-0.10 (small adjust
                     //   from user demo -2.87 since box X moved +0.10)
  Socket12: -2.69,   // magazine box at x=-1.85, z=+0.10
  Conv:     -0.66,   // tray on Conv1 left end (x=-1.40, z=+0.45)
};
const r1Over   = (joint0) => ({ joint0, joint1:  0.00, joint2: -PI_2, joint3: 0, joint4: -PI_2, joint5: 0 });
const r1AtPick = (joint0) => ({ joint0, joint1: -0.36, joint2: -1.36, joint3: 0, joint4: -PI_2, joint5: 0 });
const r1AtPlc  = (joint0) => ({ joint0, joint1: -0.49, joint2: -1.02, joint3: 0, joint4: -PI_2, joint5: 0 });

// Per-cycle scheduling. Linear sums of the phase durations below give
// 7640 ms; round up to 7700 so the next cycle starts after release lifts.
const R1_T_TRAVEL  = 1500;
const R1_T_DESCEND =  900;
const R1_T_LIFT    =  650;
const R1_T_GRIP    =  300;
const R1_T_SETTLE  =  120;
const R1_CYCLE_MS  = 7700;

// ── R1 — replay-style tray loader ───────────────────────────────────────
// Spawns a socket at the magazine, then walks the arm through the
// captured pose chain. Sockets get re-parented under the tray on release
// so they ride along when Conv1 restarts. Cycles serialize via setTimeout
// (next cycle starts at `t += R1_CYCLE_MS`); R2/R3 still use IK-based
// pickPlaceSequence.
export function loadTraySequence({ robot, simRegistry, tray, sockets, onComplete, t0 = 0 }) {
  let t = t0;
  for (const sockSpec of sockets) {
    const j0Pick = R1_JOINT0[sockSpec.type] ?? R1_JOINT0.Socket8;
    const j0Plc  = R1_JOINT0.Conv;

    setTimeout(() => {
      const socket = simRegistry.add(sockSpec.type);
      const pickW = MAGAZINE_PICK[sockSpec.type] ?? MAGAZINE_PICK.Socket8;
      socket.root.position.copy(pickW);
      if (sockSpec.defective) socket.setParam('defective', true);
      if (tray._fromOrder != null) socket._fromOrder = tray._fromOrder;

      let st = 0;
      // Approach magazine → descend → capture socket THEN close jaws.
      // Capture-before-close means the socket snaps to the gripper's hold
      // point first, then the jaws animate around it — visually "the
      // robot grabs and holds" instead of "jaws close on empty air, then
      // the socket teleports into them".
      setTimeout(() => robot.animateToPose(r1Over(j0Pick),   R1_T_TRAVEL),  st); st += R1_T_TRAVEL  + R1_T_SETTLE;
      setTimeout(() => robot.animateToPose(r1AtPick(j0Pick), R1_T_DESCEND), st); st += R1_T_DESCEND + R1_T_SETTLE;
      setTimeout(() => { robot.pickSocket(socket); robot.closeGripper(R1_T_GRIP); }, st); st += R1_T_GRIP + 100;
      setTimeout(() => robot.animateToPose(r1Over(j0Pick),   R1_T_LIFT),    st); st += R1_T_LIFT    + R1_T_SETTLE;
      // Transit to conveyor → descend → release → snap to tray slot → lift.
      setTimeout(() => robot.animateToPose(r1Over(j0Plc),    R1_T_TRAVEL),  st); st += R1_T_TRAVEL  + R1_T_SETTLE;
      setTimeout(() => robot.animateToPose(r1AtPlc(j0Plc),   R1_T_DESCEND), st); st += R1_T_DESCEND + R1_T_SETTLE;
      setTimeout(() => robot.openGripper(R1_T_GRIP),                       st); st += 80;
      setTimeout(() => {
        if (robot.heldSocket) robot.releaseSocket();
        // Snap into the tray's next slot (local frame) so subsequent
        // conveyor motion carries the socket with the tray.
        const slot = tray._slots[tray.params.filled];
        if (slot) {
          tray.root.attach(socket.root);
          socket.root.position.set(slot.x, tray.params.thickness + 0.020, slot.z);
          socket.root.rotation.set(0, 0, 0);
          tray.params.filled++;
        }
      }, st);
      st += (R1_T_GRIP - 80) + R1_T_SETTLE;
      setTimeout(() => robot.animateToPose(r1Over(j0Plc),    R1_T_LIFT),    st); st += R1_T_LIFT    + R1_T_SETTLE;
    }, t);
    t += R1_CYCLE_MS;
  }
  // Done with all sockets — return R1 to HOME and signal completion.
  setTimeout(() => robot.animateToPose(HOME_POSE, 900), t); t += 900;
  setTimeout(onComplete, t);
}

// ── Generic IK-driven pick → place → home ───────────────────────────────
// Returns the schedule end time so a caller can chain robots.
//   pickLift  — vertical clearance above pick spot (default 0.10)
//   placeLift — vertical clearance above place spot (default 0.10)
//               R3's elevator drop uses a larger value so the gripper
//               descends from above the cage top instead of from the side.
//
// IK strategy: per-joint damping biased so joint0 (base yaw) absorbs
// most of the lateral motion, while joint1-3 barely move from HOME.
// The arm shape stays close to HOME silhouette through the cycle and
// the visible motion is "rotate base, dip, lift, rotate base, dip" —
// the same minimal-motion choreography you'd see on a real industrial
// pick-place at low load. Without per-joint damping, CCD lets the
// shoulder/elbow flop around to chase each target and the body looks
// folded across the workspace.
export function pickPlaceSequence({ robot, simRegistry, pickWorldPos, placeWorldPos,
                                    socketToPick, t0 = 0, ikOpts = {},
                                    pickLift = APPROACH_LIFT,
                                    placeLift = APPROACH_LIFT,
                                    onPlaced = null }) {
  const chainOpts = {
    ...ikOpts,
    lockJoints: ['joint4', 'joint5'],
    startPose: HOME_POSE,
    iterations: 250,    // override caller's value: low-damping joints
                        //   below need more iterations to settle
    damping: 0.45,
    dampingPerJoint: {
      joint0: 0.55,   // base yaw: bigger steps so it converges on the
                      //           required heading without dragging the
                      //           shoulder along
      joint1: 0.10,   // shoulder, elbow, forearm: tiny per-step so they
      joint2: 0.10,   //           contribute small corrections only —
      joint3: 0.10,   //           they end up close to HOME values
    },
  };

  const overPickW  = tcpTargetAt(pickWorldPos,  pickLift);
  const atPickW    = tcpTargetAt(pickWorldPos,  0);
  const overPlaceW = tcpTargetAt(placeWorldPos, placeLift);
  const atPlaceW   = tcpTargetAt(placeWorldPos, 0);

  const plans = planChain(robot, [
    overPickW, atPickW,
    overPlaceW, atPlaceW,
  ], chainOpts);
  if (!plans) return t0;
  const [overPick, atPick, overPlace, atPlace] = plans;
  const homeReturn = unwrapPoseFrom(HOME_POSE, overPlace);

  let t = t0;
  setTimeout(() => robot.animateToPose(overPick,   D_TRAVEL),  t); t += D_TRAVEL  + D_SETTLE;
  setTimeout(() => robot.animateToPose(atPick,     D_DESCEND), t); t += D_DESCEND + D_SETTLE;
  setTimeout(() => robot.closeGripper(D_GRIP),                 t); t += D_GRIP;
  setTimeout(() => robot.pickSocket(socketToPick),             t); t += D_HOLD_AFTER_GRIP;
  setTimeout(() => robot.animateToPose(overPick,   D_LIFT),    t); t += D_LIFT    + D_SETTLE;
  setTimeout(() => robot.animateToPose(overPlace,  D_TRAVEL),  t); t += D_TRAVEL  + D_SETTLE;
  setTimeout(() => robot.animateToPose(atPlace,    D_DESCEND), t); t += D_DESCEND + D_SETTLE;
  setTimeout(() => robot.openGripper(D_GRIP),                  t); t += 80;
  setTimeout(() => {
    if (robot.heldSocket) robot.releaseSocket();
    if (onPlaced && socketToPick) onPlaced(socketToPick);
  }, t);
  t += (D_GRIP - 80) + D_SETTLE;
  setTimeout(() => robot.animateToPose(overPlace,  D_LIFT),    t); t += D_LIFT    + D_SETTLE;
  setTimeout(() => robot.animateToPose(homeReturn, D_HOME),    t); t += D_HOME;
  return t;
}

// ── R2 — replay-style defect-reject ─────────────────────────────────────
// Mirrors loadTraySequence's scheduling style but for R2:
//   HOME → over_pick → at_pick (close jaws + capture)
//        → lift+rotate (~74° left) → over_place → at_place (release)
//        → over_place → HOME
// Replays the captured choreography exactly — no IK runs each cycle.
export function defectRejectSequence({ robot, simRegistry, socketToPick,
                                       t0 = 0, onComplete, onPlaced }) {
  let t = t0;
  const TRAVEL  = R1_T_TRAVEL;
  const DESCEND = R1_T_DESCEND;
  const LIFT    = R1_T_LIFT;
  const GRIP    = R1_T_GRIP;
  const SETTLE  = R1_T_SETTLE;

  // Approach over Conv2 → descend → capture-then-close (snap socket to
  // hold point first so the jaws appear to close around it).
  setTimeout(() => robot.animateToPose(POSE_R2_REPLAY_OVER_PICK,  TRAVEL),  t); t += TRAVEL  + SETTLE;
  setTimeout(() => robot.animateToPose(POSE_R2_REPLAY_AT_PICK,    DESCEND), t); t += DESCEND + SETTLE;
  setTimeout(() => {
    if (socketToPick) robot.pickSocket(socketToPick);
    robot.closeGripper(GRIP);
  }, t); t += GRIP + D_HOLD_AFTER_GRIP;
  // Lift + swing left toward reject bin (transit pose).
  setTimeout(() => robot.animateToPose(POSE_R2_REPLAY_LIFT,       LIFT),    t); t += LIFT    + SETTLE;
  // Extend down toward bin → at_place → release.
  setTimeout(() => robot.animateToPose(POSE_R2_REPLAY_OVER_PLACE, TRAVEL/2),t); t += TRAVEL/2 + SETTLE;
  setTimeout(() => robot.animateToPose(POSE_R2_REPLAY_AT_PLACE,   DESCEND), t); t += DESCEND + SETTLE;
  setTimeout(() => robot.openGripper(GRIP),                                 t); t += 80;
  setTimeout(() => {
    if (robot.heldSocket) robot.releaseSocket();
    if (onPlaced && socketToPick) onPlaced(socketToPick);
  }, t); t += (GRIP - 80) + SETTLE;
  setTimeout(() => robot.animateToPose(POSE_R2_REPLAY_OVER_PLACE, LIFT),    t); t += LIFT    + SETTLE;
  setTimeout(() => robot.animateToPose(HOME_POSE,                 D_HOME),  t); t += D_HOME;
  if (onComplete) setTimeout(onComplete, t);
  return t;
}

// ── R3 — replay-style weigh+sort ────────────────────────────────────────
// Mirrors loadTraySequence's scheduling style. Five phases:
//   1. Pick socket off the parked tray   (HOME → POSE_A)
//   2. Place on scale + hold for weight   (POSE_A → POSE_B)
//   3. Re-pick off the scale              (POSE_B at_B → over_B)
//   4. Place on dispatch table            (POSE_B → POSE_C)
//   5. Return home                        (POSE_C → HOME)
// POSE_A sits over the parked tray (joint0 ≈ home), POSE_B over the
// scale (~+26°), POSE_C over the dispatch table (~+87° toward +X).
// Snaps the held socket onto scale/dispatch surfaces on release so the
// world parent matches the visible position.
export function weighAndSortSequence({ robot, simRegistry, socketToPick,
                                       t0 = 0, onComplete, onPlaced }) {
  let t = t0;
  const TRAVEL  = R1_T_TRAVEL;
  const DESCEND = R1_T_DESCEND;
  const LIFT    = R1_T_LIFT;
  const GRIP    = R1_T_GRIP;
  const SETTLE  = R1_T_SETTLE;
  const WEIGH_HOLD = 2500;   // dwell so the operator sees the reading

  // 1. Approach POSE_A (over parked tray) → descend → capture-then-close.
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_OVER_A, TRAVEL),  t); t += TRAVEL  + SETTLE;
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_AT_A,   DESCEND), t); t += DESCEND + SETTLE;
  setTimeout(() => {
    if (socketToPick) robot.pickSocket(socketToPick);
    robot.closeGripper(GRIP);
    // Pre-set scale's expected weight so the readout flips to ✓ once
    // the socket lands on the platform (visual reinforcement of phase 2).
    const scale = simRegistry.getObjectsByType('WeightScale')[0];
    if (scale && socketToPick) {
      const expectedW = socketToPick.type === '8핀소켓'
        ? scale.params.socket8Weight : scale.params.socket12Weight;
      scale.setParam('expectedWeight', expectedW);
    }
  }, t); t += GRIP + D_HOLD_AFTER_GRIP;
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_OVER_A, LIFT),    t); t += LIFT    + SETTLE;
  // 2. Move to POSE_B (over scale) → descend → release on scale top.
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_OVER_B, TRAVEL),  t); t += TRAVEL  + SETTLE;
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_AT_B,   DESCEND), t); t += DESCEND + SETTLE;
  setTimeout(() => robot.openGripper(GRIP),                             t); t += 80;
  setTimeout(() => {
    if (robot.heldSocket) robot.releaseSocket();
    const scale = simRegistry.getObjectsByType('WeightScale')[0];
    if (scale && socketToPick) {
      // Snap onto scale top in WORLD coords (don't reparent) so the
      // scale's own update() picks the socket up via its detection
      // sphere and the actualWeight readout reflects the load.
      const sp = new THREE.Vector3();
      scale.root.getWorldPosition(sp);
      const platTopY = sp.y + (scale.params.platHeight ?? 0.06) * 0.5 + 0.012;
      socketToPick.root.position.set(sp.x, platTopY, sp.z);
      socketToPick.root.rotation.set(0, 0, 0);
    }
  }, t); t += (GRIP - 80) + SETTLE;
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_OVER_B, LIFT),    t); t += LIFT    + SETTLE;
  // 3. Hold above the scale so the weight reading is visible.
  t += WEIGH_HOLD;
  // 4. Re-pick socket from the scale (capture-then-close).
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_AT_B,   DESCEND), t); t += DESCEND + SETTLE;
  setTimeout(() => {
    if (socketToPick) robot.pickSocket(socketToPick);
    robot.closeGripper(GRIP);
  }, t); t += GRIP + D_HOLD_AFTER_GRIP;
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_OVER_B, LIFT),    t); t += LIFT    + SETTLE;
  // 5. Continue to POSE_C → descend → release on dispatch table.
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_OVER_C, TRAVEL),  t); t += TRAVEL  + SETTLE;
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_AT_C,   DESCEND), t); t += DESCEND + SETTLE;
  setTimeout(() => robot.openGripper(GRIP),                             t); t += 80;
  setTimeout(() => {
    if (robot.heldSocket) robot.releaseSocket();
    if (socketToPick) {
      // Route into the matching dispatch bin (8핀 → Socket8 box, 12핀 → Socket12).
      const sockKey = socketToPick.type === '8핀소켓' ? 'Socket8'
                    : socketToPick.type === '12핀소켓' ? 'Socket12'
                    : null;
      const targetBox = simRegistry.getObjectsByType('StorageBox')
        .find((b) => b._dispatchBox && b.params.sockType === sockKey);
      if (targetBox) {
        const idx = targetBox.params.count ?? 0;
        const col = idx % 3, row = Math.floor(idx / 3) % 3, layer = Math.floor(idx / 9);
        targetBox.root.attach(socketToPick.root);
        socketToPick.root.position.set(
          (col - 1) * 0.030,
          0.012 + layer * 0.020,
          (row - 1) * 0.030,
        );
        socketToPick.root.rotation.set(0, 0, 0);
        targetBox.setParam('count', idx + 1);
      } else {
        // Fallback: dispatch table top (untyped socket or missing bin).
        const dispatchTable = simRegistry.getObjectsByType('Table')
          .find((tb) => tb._dispatch);
        if (dispatchTable) {
          dispatchTable.root.attach(socketToPick.root);
          const h = dispatchTable.params.height ?? 0.20;
          socketToPick.root.position.set(0, h / 2 + 0.02, 0);
          socketToPick.root.rotation.set(0, 0, 0);
        }
      }
    }
    if (onPlaced && socketToPick) onPlaced(socketToPick);
  }, t); t += (GRIP - 80) + SETTLE;
  setTimeout(() => robot.animateToPose(POSE_R3_REPLAY_OVER_C, LIFT),    t); t += LIFT    + SETTLE;
  // 6. Return home so the next cycle starts from a clean pose.
  setTimeout(() => robot.animateToPose(HOME_POSE,             D_HOME),  t); t += D_HOME;
  if (onComplete) setTimeout(onComplete, t);
  return t;
}
