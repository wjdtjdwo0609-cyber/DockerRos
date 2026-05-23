// Predefined factory scenarios. The "socket sorting line" lays out a
// realistic 3-robot pick → inspect → weigh → stack flow:
//
//   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
//   │  Robot 1    │    │  Robot 2    │    │  Robot 3    │
//   │  (supply)   │    │  (defect    │    │  (weigh +   │
//   │             │    │   inspect)  │    │   stack)    │
//   │ Table       │    │             │    │ Scale       │
//   │ Box8 Box12  │    │             │    │ Elevator    │
//   │ TopCam ↓    │    │ DefectCam ↓ │    │             │
//   └─────────────┘    └─────────────┘    └─────────────┘
//        Conv1 ────────► Conv2 ────────► Conv3
//        (Y030)           (Y031)           (Y032)
//
// Each conveyor / camera / scale gets a sensible default OPC UA binding so
// GX Works2 ladder logic drops in without hand-config.

import * as THREE from 'three';
import { planIKToTarget, planChain, unwrapPoseFrom } from '../robot-control/index.js';

const ROBOT_TYPE = 'indy7';

// Module-level dispense queue + refs to the feeder hardware. The order
// panel pushes ORDER objects here via enqueueDispense(); each order =
// one tray + a list of socket specs to load onto it. The cylinder pops
// one order per stroke, spawns a tray on Conv1, then R1 loads the
// sockets. Conv1 is paused for the loading window so the tray waits.
//
// Resetting `queue.length = 0` on scenario reload preserves identity
// (other modules holding the ref see it cleared).
const _feederState = {
  queue: [],          // [{ orderId, sockets: [{type, defective?}, ...] }, ...]
  simRegistry: null,
  cylinder: null,
  sensor: null,
  conv1: null,
  robotManager: null,
  r1Busy: false,      // true while R1 is loading a tray; cylinder waits
};

// Push an order onto the supply line. Each order maps to ONE tray.
// `items` is a list of orders, each with { orderId, sockets }.
export function enqueueDispense(items) {
  if (!_feederState.cylinder) return; // scenario not loaded yet
  for (const it of items) _feederState.queue.push(it);
  if (_feederState.sensor && _feederState.queue.length > 0) {
    _feederState.sensor.setParam('detected', true);
  }
}

export function dispenseQueueLength() {
  return _feederState.queue.length;
}

// Soft-stop the feeder: drop any pending orders + flip the sensor off so
// the cylinder's tickHook drives `running` back to false. Used by the
// "전체 정지" / "자동 테스트 정지" buttons — without this, the tickHook
// would keep re-enabling the cylinder while the queue still had items
// even though the operator pressed stop.
export function clearDispenseQueue() {
  _feederState.queue.length = 0;
  if (_feederState.sensor) _feederState.sensor.setParam('detected', false);
}

// Vertical clearance: how high above the target the gripper hovers before
// descending. Larger = more "industrial" approach but slower cycle.
const APPROACH_LIFT = 0.10;
// The gripper extends ~10 cm beyond TCP (its hold point lives at local
// (0,0,0.10)). When commanding TCP via IK, target = world-pick-position
// minus this offset along the gripper's approach axis. We use world +Y
// (gripper coming down from above) so target_TCP = pick_world + Y*hold.
const HOLD_OFFSET = 0.10;

// ── Robot poses (Indy7 6DOF) ────────────────────────────────────────────
// "home" = the C-shape ready-to-pick pose (operator-tuned visual reference).
// All non-zero joints sit at clean ±π/2; TCP ends up next to the conveyor
// at conveyor-belt height, ready to grab a socket placed beside the robot.
const PI_2 = Math.PI / 2;
export const HOME_POSE = {
  joint0: -PI_2,  // base yawed 90° toward conveyor side
  joint1:  0.00,  // shoulder vertical
  joint2: -PI_2,  // elbow folded back 90°
  joint3:  0.00,
  joint4: -PI_2,  // wrist tilted 90° (TCP points down)
  joint5:  0.00,
};
// Multi-stage work poses (approach, descend, lift). Each step keeps joint
// changes small so the arm stays in its footprint, with shoulder (joint1)
// driving vertical motion and base (joint0) driving lateral travel.
function pose(deltas = {}) { return { ...HOME_POSE, ...deltas }; }

// R1 supply: pick from table to the LEFT of R1 (joint0 = -π faces world -X,
// where the supply table is), place on conveyor in front (-π/2 = home).
// Table top is at conveyor belt height, so the AT pose only needs a small
// dip (joint1 = +0.10) — large dip would clip through the table.
const R1_PICK_J0  = -Math.PI;    // face supply table on the left
const R1_PLACE_J0 = -PI_2;       // face conveyor in front (= home)
export const POSE_R1_OVER_PICK  = pose({ joint0: R1_PICK_J0,  joint1: -0.30 });
export const POSE_R1_AT_PICK    = pose({ joint0: R1_PICK_J0,  joint1:  0.10 });
export const POSE_R1_OVER_PLACE = pose({ joint0: R1_PLACE_J0, joint1: -0.30 });
export const POSE_R1_AT_PLACE   = pose({ joint0: R1_PLACE_J0, joint1:  0.10 });

// R2 inspection: lean over belt (no pick — vision passes overhead).
export const POSE_R2_INSPECT    = pose({ joint1: 0.30, joint4: -1.20 });

// R2 replay-style defect-reject sequence (captured from indy7 #3 slider
// demo). Pick over Conv2 (joint0 = -1.39, slight right of home) → swing
// ~74° left and drop in reject bin (joint0 = -2.69). Wrist locked at
// j4 = -1.61 / j5 = +0.17 — a distinct slight twist that diverges from
// R1/R3's vertical-down convention. joint3 stays near zero (-0.01 → +0.03
// micro-adjust at place). Used by `defectRejectSequence()` for replay
// playback instead of solving IK each cycle.
export const POSE_R2_REPLAY_OVER_PICK  = { joint0: -1.39, joint1:  0.00, joint2: -1.57, joint3:  0.00, joint4: -1.61, joint5: 0.17 };
export const POSE_R2_REPLAY_AT_PICK    = { joint0: -1.39, joint1: -0.53, joint2: -1.40, joint3: -0.01, joint4: -1.61, joint5: 0.17 };
export const POSE_R2_REPLAY_LIFT       = { joint0: -2.69, joint1: -0.18, joint2: -1.40, joint3: -0.01, joint4: -1.61, joint5: 0.17 };
export const POSE_R2_REPLAY_OVER_PLACE = { joint0: -2.69, joint1: -0.67, joint2: -1.11, joint3: -0.01, joint4: -1.61, joint5: 0.17 };
export const POSE_R2_REPLAY_AT_PLACE   = { joint0: -2.69, joint1: -0.67, joint2: -1.45, joint3:  0.03, joint4: -1.61, joint5: 0.17 };

// R3 stack: pick from scale (just forward of robot), place on elevator
// (a bit further along +X). Same pattern as R1.
const R3_PICK_J0  = -PI_2;             // home direction (scale is right there)
const R3_PLACE_J0 = -PI_2 + 0.50;      // rotate toward elevator
export const POSE_R3_OVER_PICK  = pose({ joint0: R3_PICK_J0,  joint1: -0.40 });
export const POSE_R3_AT_PICK    = pose({ joint0: R3_PICK_J0,  joint1:  0.20 });
export const POSE_R3_OVER_PLACE = pose({ joint0: R3_PLACE_J0, joint1: -0.40 });
export const POSE_R3_AT_PLACE   = pose({ joint0: R3_PLACE_J0, joint1:  0.20 });

// R3 replay-style 3-station sequence (captured from indy7 #4 slider demo).
// Three work stations along a +X sweep — pick over scale at A, transit
// through B, dispatch at C (toward exit/elevator side). joint0 walks
// -1.59 → -1.11 → -0.07 (~87° rightward arc), wrist tightens with reach
// (joint4 -1.34 → -1.58 → -1.60). joint5 stays at 0 (R1 convention).
// Used by `weighAndSortSequence()` to replay the captured choreography
// instead of solving IK each cycle.
export const POSE_R3_REPLAY_OVER_A = pose({ joint0: -1.59 });
export const POSE_R3_REPLAY_AT_A   = { joint0: -1.59, joint1: -0.38, joint2: -1.53, joint3: 0.09, joint4: -1.34, joint5: 0.00 };
export const POSE_R3_REPLAY_OVER_B = pose({ joint0: -1.11 });
export const POSE_R3_REPLAY_AT_B   = { joint0: -1.11, joint1: -0.38, joint2: -1.40, joint3: 0.06, joint4: -1.58, joint5: 0.00 };
export const POSE_R3_REPLAY_OVER_C = pose({ joint0: -0.07 });
export const POSE_R3_REPLAY_AT_C   = { joint0: -0.07, joint1: -0.35, joint2: -1.49, joint3: 0.07, joint4: -1.60, joint5: 0.00 };

// Returns Promise that resolves when scene is fully populated.
export async function loadFactoryScenario({ simRegistry, robotManager, statusEl, orderPanel }) {
  if (statusEl) statusEl.textContent = '🏭 시나리오 로드 중…';

  // 1. Clear existing scene first so the layout is deterministic.
  for (const obj of [...simRegistry.objects.values()]) simRegistry.remove(obj.id);
  for (const r of robotManager.getAll()) robotManager.remove(r.id);

  // 2. Three Indy7 robots in a row along +X, facing +Z (toward conveyor).
  const robotPositions = [
    [-1.5, 0, 0],  // R1: supply
    [ 0.0, 0, 0],  // R2: defect inspection
    [ 1.5, 0, 0],  // R3: weigh + stack
  ];
  const robots = [];
  const _lineCids = ['r1', 'r2', 'r3'];   // creation order = R1, R2, R3
  for (const [x, y, z] of robotPositions) {
    const r = await robotManager.add(ROBOT_TYPE);
    r.urdf.position.set(x, y, z);
    // 시뮬 표시 전용: 로봇을 선 채로 제자리 yaw 회전.
    // URDF 가 rotation.x=-90°로 세워져 있어 yaw 는 z축으로 줘야 한다
    // (y축을 주면 로봇이 눕는다). 실제 로봇/relay 와 무관.
    // 기존 -PI/2 에서 메인축(z) 기준 반시계 90° 추가 회전 → 0.
    r.urdf.rotation.z = 0;
    r.setPose(HOME_POSE);     // start in ready-to-work pose, not all-zeros
    r.attachGripper();        // every robot in this scenario uses a gripper
    // Tag the real-line channel so /<cid>/joint_states drives exactly this
    // arm. Additive only — taught/captured scenarios are untouched.
    r.urdf.userData.cid = _lineCids[robots.length] || null;
    robots.push(r);
  }

  // 3. Three conveyor segments running through all 3 stations along +X.
  // Each conveyor binds to Conv1/Conv2/Conv3 (Y030/Y031/Y032).
  // Conv3 is shorter (0.85 m, centered at 0.925) so its right edge sits
  // at x=1.35 — pulling the dispatch end of the line ~15 cm closer to R3
  // so R3's captured POSE_A reach lands on the parked tray.
  const convSpecs = [
    { center: -1.0,  length: 1.0,  tag: 'Conv1' },
    { center:  0.0,  length: 1.0,  tag: 'Conv2' },
    { center:  0.925, length: 0.85, tag: 'Conv3' },
  ];
  for (const { center, length, tag } of convSpecs) {
    const c = simRegistry.add('ConveyorBelt', { length, width: 0.22 });
    c.root.position.set(center, 0, 0.45);
    c.opcua.tag = tag;
    c.opcua.direction = 'read';
    c.opcua.paramName = 'running';
    c.params.speed = 0.25;
  }

  // 4. Supply station — magazine table sits DIRECTLY to R1's left at
  // z=0 (same row as the robot bases) so it stays out of R1's forward
  // working envelope toward the conveyor. The pneumatic cylinder is a
  // separate unit at z=0.45 (conveyor row) that drops plates onto Conv1's
  // left end. They're functionally one feeder; the split position keeps
  // the magazine visually "off to the side" while the cylinder lives
  // where it can actually push onto the belt.
  //
  // Layout (top-down):
  //                                 R1 (-1.5, 0, 0)        Conv1 ──►
  //                                      ▼
  //   z=0.45            ┌Sensor┐ ╔═Cyl═╗──rod──> spawn (-1.46, ?, 0.45)
  //
  //                ┌─────┐
  //   z=+0.10      │Box12│  ← long side (0.40 m) faces +X toward R1
  //                ├─────┤
  //   z=−0.10      │Box8 │
  //                └─────┘
  //                x=-1.80, w=0.18, d=0.40 — table close to R1
  //
  const TABLE_X = -1.85;             // pulled in 10cm closer to R1 / belt
  const TABLE_Z =  0.00;
  const TABLE_HEIGHT = 0.20;
  // Long side (depth=0.40) along Z, facing R1 along +X. Width (X) is
  // the short dimension so the robot doesn't have to reach across.
  const table = simRegistry.add('Table', { width: 0.18, depth: 0.40, height: TABLE_HEIGHT });
  table.root.position.set(TABLE_X, 0, TABLE_Z);

  // Boxes stacked along Z (the long axis) — both share the table's X
  // center so R1 only swings to address one Z position per pick.
  const box8 = simRegistry.add('StorageBox', { capacity: 10, sockType: 'Socket8' });
  box8.root.position.set(TABLE_X, TABLE_HEIGHT, TABLE_Z - 0.10);
  box8.setParam('count', 10);

  const box12 = simRegistry.add('StorageBox', { capacity: 10, sockType: 'Socket12' });
  box12.root.position.set(TABLE_X, TABLE_HEIGHT, TABLE_Z + 0.10);
  box12.setParam('count', 10);

  // Support table for the feeder station — extends from the cylinder
  // body all the way to Conv1's left edge so the tray never crosses an
  // open gap during the push (a tray sliding off the magazine would
  // fall through the gap otherwise). Top y matches the cylinder's
  // chosen root height so its mounting base sits flush.
  //   • Conv1 left edge: x = -1.50 (Conv1 center -1.0, length 1.0)
  //   • Cylinder body left edge: x = -2.25 (root -2.18, half-length 0.07)
  //   → table spans X∈[-2.25, -1.50], width 0.75, center -1.875.
  const FEEDER_TABLE_TOP = 0.157;
  const feederTable = simRegistry.add('Table', {
    width: 0.75, depth: 0.22, height: FEEDER_TABLE_TOP,
  });
  feederTable.root.position.set(-1.875, 0, 0.45);

  // Tray magazine — transparent acrylic stack of empty trays. The
  // bottom slot opens on +X (toward Conv1) so the cylinder behind the
  // stack pushes the bottom tray out and onto the belt. mountHeight
  // raises the bottom tray on stilts so its center aligns with the
  // cylinder rod (rod_y = cyl_root_y + 0.08 = 0.237).
  const trayStack = simRegistry.add('TrayStack', {
    width: 0.20, depth: 0.18, trayCount: 6,
    mountHeight: 0.069,             // rod_y(0.237) − table_top(0.157) − tray_half(0.011)
  });
  trayStack.root.position.set(-1.85, FEEDER_TABLE_TOP, 0.45);

  // Order sensor — fires (detected=true) while the dispense queue is
  // non-empty, drives the cylinder. Mounted on the side of the magazine,
  // visible to the operator as an "order ready" lamp.
  const orderSensor = simRegistry.add('Sensor', { range: 0.18 });
  orderSensor.root.position.set(-1.95, 0.50, 0.45);
  orderSensor.opcua.tag = 'OrderReady';
  orderSensor.opcua.direction = 'write';
  orderSensor.opcua.paramName = 'detected';

  // Feeder cylinder — body fully behind the magazine (x < -2.05 stack
  // edge). Stroke 0.50 so the rod traverses the magazine and pushes the
  // bottom tray onto Conv1's left end. Rod tip world X formula:
  //   tip_x = root_x + 0.176 + stroke
  // → at root_x=-2.18 stroke=0.50, extended tip = -1.504 (Conv1 entry).
  // Cylinder is lowered (root_y=0.157) so rod_y aligns with the bottom
  // tray's top surface — visually the rod pushes the right tray.
  const feeder = simRegistry.add('Cylinder', { stroke: 0.50 });
  feeder.root.position.set(-2.08, 0.157, 0.45);
  feeder.params.running = false;          // gated on the sensor below
  feeder.opcua.tag = 'Feeder';

  // Wire feeder ↔ sensor + dispense queue. Each cylinder extension pops
  // ONE order from the queue, spawns an empty tray on Conv1, pauses Conv1
  // so the tray waits, and kicks off R1's loading sequence. After R1
  // finishes loading the requested sockets, Conv1 resumes and the tray
  // travels to R2/R3 (carrying the sockets parented under it).
  _feederState.queue.length = 0;
  _feederState.simRegistry = simRegistry;
  _feederState.cylinder = feeder;
  _feederState.sensor = orderSensor;
  _feederState.robotManager = robotManager;
  _feederState.r1Busy = false;
  const conv1Ref = [...simRegistry.objects.values()]
    .find((o) => o.type === 'Conveyor' && o.opcua?.tag === 'Conv1');
  _feederState.conv1 = conv1Ref;

  // Tray spawn endpoints. The tray is born inside the magazine at
  // MAGAZINE_X and rides the cylinder rod out to SPAWN_X (Conv1 entry)
  // over the course of one extension stroke. Spawning at MAGAZINE_X
  // first makes the dispense look like the rod is genuinely pushing
  // the tray — instead of the previous behavior where a tray
  // teleported in at SPAWN_POS the moment the rod hit full extension.
  const MAGAZINE_X = -1.85;
  const SPAWN_X    = -1.40;
  const SPAWN_POS  = new THREE.Vector3(SPAWN_X, 0.225, 0.45);
  let _dispensingTray = null;   // { tray, order } during the push phase

  feeder._onExtended = () => {
    // Push complete. Lock the tray at Conv1 entry and hand control over
    // to R1. (Tray creation already happened in the hook below at the
    // start of the stroke — by here it has already ridden the rod out.)
    if (!_dispensingTray) return;
    const { tray, order } = _dispensingTray;
    tray.root.position.copy(SPAWN_POS);
    tray._beingDispensed = false;
    _dispensingTray = null;

    if (conv1Ref) conv1Ref.params.running = false;
    if (_feederState.queue.length === 0) {
      orderSensor.setParam('detected', false);
    }
    const r1 = robotManager.getAll()[0];
    if (r1 && order.sockets.length > 0) {
      _feederState.r1Busy = true;
      loadTraySequence({
        robot: r1, simRegistry, tray,
        sockets: order.sockets,
        onComplete: () => {
          _feederState.r1Busy = false;
          if (conv1Ref) conv1Ref.params.running = true;
        },
      });
    } else if (conv1Ref) {
      conv1Ref.params.running = true;
    }
  };

  // Per-frame hooks. Reset first so scenario reloads don't stack handlers.
  simRegistry.tickHooks.length = 0;

  // Hook A — gate cylinder running on sensor + r1 idle, AND spawn a new
  // tray at the magazine end the moment a fresh extension stroke begins.
  simRegistry.tickHooks.push(() => {
    feeder.params.running = !!orderSensor.params.detected
                          && !_feederState.r1Busy;

    if (_dispensingTray) return;              // already mid-push
    if (!feeder.params.running) return;
    if (feeder.params.stroke > 0.02) return;  // wait for retracted state
    if (_feederState.queue.length === 0) return;

    // Don't start while a previous tray is still occupying Conv1.
    const traysOnConv1 = simRegistry.getObjectsByType('Tray')
      .some((t) => !t._beingDispensed && t.root.position.x < -0.50);
    if (traysOnConv1) return;

    const order = _feederState.queue.shift();
    const tray = simRegistry.add('Tray', {
      capacity: Math.max(1, order.sockets.length),
    });
    tray.root.position.set(MAGAZINE_X, 0.225, 0.45);
    tray._fromOrder = order.orderId;
    tray._beingDispensed = true;
    _dispensingTray = { tray, order };
  });

  // Hook B — while a tray is being dispensed, ride it along with the
  // cylinder rod so the visual matches "rod pushes the tray onto Conv1".
  simRegistry.tickHooks.push(() => {
    if (!_dispensingTray) return;
    const { tray } = _dispensingTray;
    if (!tray || !tray.root) { _dispensingTray = null; return; }
    const phase = Math.min(1, feeder.params.stroke / feeder.params.strokeMax);
    tray.root.position.x = MAGAZINE_X + (SPAWN_X - MAGAZINE_X) * phase;
  });
  // Park the next incoming tray at x=1.40 by stopping Conv3 the first
  // time a tray crosses x=1.30. Snap X lines up with sidePusher's X
  // and Conv3's right edge (1.35) so the gripper descends straight onto
  // the tray's socket and the rod pushes the tray it's parked next to.
  // The R3 event hook in setupRobotEventLoops picks up `_stoppedAtScale`
  // and resumes Conv3 once the cycle's done.
  simRegistry.tickHooks.push(() => {
    const conv3 = [...simRegistry.objects.values()]
      .find((o) => o.type === 'Conveyor' && o.opcua?.tag === 'Conv3');
    if (!conv3) return;
    const trays = simRegistry.getObjectsByType('Tray');
    for (const tr of trays) {
      if (!tr._stoppedAtScale && tr.root.position.x >= 1.30) {
        tr._stoppedAtScale = true;
        tr.root.position.x = 1.40;     // snap for clean alignment
        conv3.params.running = false;
      }
    }
  });

  // Top-down vision camera mounted above the magazine table.
  const topCam = simRegistry.add('VisionCamera', { range: 0.45 });
  topCam.root.position.set(TABLE_X, 0.85, TABLE_Z);
  topCam.root.rotation.x = Math.PI / 2;  // FOV cone points -Y (down)
  topCam.setParam('learned8pin', true);
  topCam.setParam('learned12pin', true);
  topCam._supplyCam = true; // marker for downstream logic

  // 5. Robot 2 — defect inspection vision camera over conveyor 2 (downward).
  // Mounted UPSTREAM of R2 (smaller x) so the FOV catches the socket
  // before R2 reaches for it — vision detects, R2 then picks the flagged
  // ones, just like a real inspection station.
  const defectCam = simRegistry.add('VisionCamera', { range: 0.35 });
  defectCam.root.position.set(-0.30, 0.65, 0.45);
  defectCam.root.rotation.x = Math.PI / 2;
  defectCam.setParam('learned8pin', true);
  defectCam.setParam('learned12pin', true);
  defectCam.opcua.tag = 'VisionDetect';
  defectCam.opcua.direction = 'write';
  defectCam.opcua.paramName = 'good';

  // Reject bin to R2's LEFT — joint0 swings ~90° from HOME (-π/2 facing
  // +Z) to face -X, which is a clean quarter-turn that fits the robot's
  // natural work envelope. Conv1 ends at x=-0.5 (z=0.45), so the bin
  // at x=-0.40, z=0 has zero conveyor conflict.
  const rejectBin = simRegistry.add('StorageBox', {
    width: 0.24, depth: 0.24, height: 0.12, capacity: 20,
  });
  rejectBin.root.position.set(-0.40, 0, 0);
  rejectBin.opcua.tag = 'RejectBin';

  // 6. Robot 3 station — weigh+sort. Tray stops at the scale, R3 lifts
  // the socket off, places it on the scale for measurement, then swings
  // ~87° right to set it on the dispatch table. A side-pusher cylinder
  // behind the conveyor flicks the now-empty tray off the line.
  //
  // All R3-side fixtures pulled ~10 cm to -X so R3's captured replay
  // poses (POSE_A on parked tray, POSE_B on scale, POSE_C on dispatch)
  // land cleanly on the right object. Scale at x=1.62, dispatch at
  // x=1.90, side-pusher + tray-park at x=1.40.
  const scaleTable = simRegistry.add('Table', { width: 0.3, depth: 0.3, height: 0.2 });
  scaleTable.root.position.set(1.62, 0, 0.45);

  const scale = simRegistry.add('WeightScale');
  scale.root.position.set(1.62, 0.2, 0.45);
  scale.setParam('expectedWeight', 0);

  // Dispatch table — landing pad on R3's POSE_C reach. The two sorting
  // bins on top split sockets by type so a downstream operator can grab
  // a full bin of just 8핀 or just 12핀. R3 picks the weighed socket off
  // the scale and routes it to the matching bin.
  const dispatchTable = simRegistry.add('Table', {
    width: 0.30, depth: 0.32, height: 0.20,
  });
  dispatchTable.root.position.set(1.90, 0, 0.05);
  dispatchTable._dispatch = true;

  const dispatch8 = simRegistry.add('StorageBox', {
    width: 0.13, depth: 0.13, height: 0.08, capacity: 20, sockType: 'Socket8',
  });
  dispatch8.root.position.set(1.90, 0.20, -0.05);
  dispatch8._dispatchBox = true;

  const dispatch12 = simRegistry.add('StorageBox', {
    width: 0.13, depth: 0.13, height: 0.08, capacity: 20, sockType: 'Socket12',
  });
  dispatch12.root.position.set(1.90, 0.20, 0.15);
  dispatch12._dispatchBox = true;

  // Side-pusher cylinder behind the conveyor — sits next to the parked
  // tray (x=1.40, where the tickHook snaps it), so the rod visually
  // lines up with what it's pushing. Single-shot: R3's weigh+sort
  // onComplete sets running=true, the cylinder strokes once,
  // _onExtended removes any tray flagged _stoppedAtScale and resets
  // running=false so the next cycle can fire it again.
  const sidePusher = simRegistry.add('Cylinder', { stroke: 0.40 });
  sidePusher.root.position.set(1.40, 0.20, 0.78);
  sidePusher.root.rotation.y = -Math.PI / 2;  // rod points -Z toward conveyor
  sidePusher.params.running = false;
  sidePusher.opcua.tag = 'ScalePusher';
  sidePusher._onExtended = () => {
    const trays = simRegistry.getObjectsByType('Tray');
    for (const tr of trays) {
      if (tr._stoppedAtScale) simRegistry.remove(tr.id);
    }
    sidePusher.params.running = false;  // single-shot reset
  };

  // Mixed defectives directly on Conv2 (under defectCam) so R2's reject
  // cycle has something to act on even before the operator submits an
  // order. Visual cue: red glow + ✕ mark above the body.
  const defectSocket1 = simRegistry.add('Socket8', { defective: true });
  defectSocket1.root.position.set(-0.18, 0.225, 0.45);
  const defectSocket2 = simRegistry.add('Socket12', { defective: true });
  defectSocket2.root.position.set(0.18, 0.225, 0.45);

  // Camera on Robot 1 active by default — user can immediately tweak joints.
  robotManager.setActive(robots[0].id);
  simRegistry.deselect();

  // Reset order panel state on fresh scenario load.
  if (orderPanel) orderPanel.reset();

  // Wire up event-driven robot loops. R1 already triggers on the cylinder
  // + OrderReady sensor; this hooks R2 to defect-vision and R3 to the
  // tray-parked tickHook so the whole line flows from sensor signals
  // instead of timer-based scheduling.
  setupRobotEventLoops({ simRegistry, robotManager });

  if (statusEl) statusEl.textContent = `✓ 시나리오 로드 완료 — 로봇 ${robots.length}대 + 오브젝트 ${simRegistry.objects.size}개`;
}

// ──────────────────────────────────────────────────────────────────────
// Welding test (homework 정답 시퀀스). Runs the exact joint sequence
// from the 5-problem template — home → p1 → 3× (p1 → p2 → p_mid → p3
// → p4 → p1) → home — converted from degrees to radians. Joint name
// mapping is robot-aware: the homework's 6-element angle array is
// applied to the first 6 joints of `robot.cfg.chain`, so it works on
// Indy7, Indy12 (joint0~joint5), UR5e/UR10e (shoulder_pan_joint…),
// Panda (panda_joint1~7, 7th held at 0), and Fanuc (joint_1~6).
// ──────────────────────────────────────────────────────────────────────
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

// Pick the closest unheld socket near a given world position.
function findClosestSocket(simRegistry, worldPos, maxDist = 1.0) {
  const sockets = simRegistry.getObjectsByTypes(['8핀소켓', '12핀소켓'])
    .filter((s) => !s._pickedBy);
  let best = null;
  let bestD = maxDist;
  const tmp = new THREE.Vector3();
  for (const s of sockets) {
    s.root.getWorldPosition(tmp);
    const d = tmp.distanceTo(worldPos);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function gripperWorldPos(robot, out = new THREE.Vector3()) {
  if (!robot.gripperGroup) {
    robot.urdf.getWorldPosition(out);
    return out;
  }
  robot.gripperGroup.updateMatrixWorld(true);
  return robot.gripperGroup.getWorldPosition(out);
}

// Sequence helper — schedules each step relative to a running cursor and
// returns the cursor (total duration). Action runs at the START of its
// allotted slot; duration is how much time is reserved before the next.
function seq(start, steps) {
  let t = start;
  for (const [delay, action] of steps) {
    t += delay;
    setTimeout(action, t);
  }
  return t;
}

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

// Industrial-style pick-and-place phase durations (ms).
const D_TRAVEL  = 1500; // long lateral move (over_pick → over_place)
const D_DESCEND =  900; // approach descent (over → at), slow for accuracy
const D_LIFT    =  650; // depart ascent (at → over)
const D_HOME    =  900; // return-home
const D_GRIP    =  300; // pneumatic close/open time
const D_SETTLE  =  120; // settle pause between waypoints
const D_HOLD_AFTER_GRIP = 100; // brief grip-hold before lifting

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
const _PICK_PLACE_DURATION_MS = R1_CYCLE_MS;

// Replay-style tray loader for R1. Spawns a socket at the magazine,
// then walks the arm through the captured pose chain. Sockets get
// re-parented under the tray on release so they ride along when Conv1
// restarts. Cycles serialize via setTimeout (next cycle starts at
// `t += R1_CYCLE_MS`); R2/R3 still use IK-based pickPlaceSequence.
function loadTraySequence({ robot, simRegistry, tray, sockets, onComplete, t0 = 0 }) {
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

// Run a full pick → place → home sequence for one robot using IK targets.
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
function pickPlaceSequence({ robot, simRegistry, pickWorldPos, placeWorldPos,
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

// Replay-style R2 defect-reject sequence using captured indy7 #3 slider demo
// poses. Mirrors `loadTraySequence`'s scheduling style but for R2:
//   HOME → over_pick → at_pick (close jaws + capture)
//        → lift+rotate (~74° left) → over_place → at_place (release)
//        → over_place → HOME
// Replays the captured choreography exactly — no IK runs each cycle.
function defectRejectSequence({ robot, simRegistry, socketToPick,
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

// Replay-style R3 weigh+sort sequence using captured indy7 #4 slider demo
// poses. Mirrors `loadTraySequence`'s scheduling style. Five phases:
//   1. Pick socket off the parked tray   (HOME → POSE_A)
//   2. Place on scale + hold for weight   (POSE_A → POSE_B)
//   3. Re-pick off the scale              (POSE_B at_B → over_B)
//   4. Place on dispatch table            (POSE_B → POSE_C)
//   5. Return home                        (POSE_C → HOME)
// POSE_A sits over the parked tray (joint0 ≈ home), POSE_B over the
// scale (~+26°), POSE_C over the dispatch table (~+87° toward +X).
// Snaps the held socket onto scale/dispatch surfaces on release so the
// world parent matches the visible position.
function weighAndSortSequence({ robot, simRegistry, socketToPick,
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

// ── Event-driven robot loops ────────────────────────────────────────────
// Replaces the old setTimeout-based runWorkCycle. Each robot wakes on its
// own sensor signal:
//   R1 — driven by OrderReady sensor + feeder cylinder (already wired).
//   R2 — defect VisionCamera flags `good=false & detectedDefective=true`.
//   R3 — a tray hits `_stoppedAtScale` (parking tickHook).
// Idempotent: every entry path checks a busy flag + per-item marker so
// the same trigger doesn't kick off the sequence twice. Runs continuously,
// so the auto-demo just enqueues orders and the rest of the line follows.
function setupRobotEventLoops({ simRegistry, robotManager }) {
  const robots = robotManager.getAll();
  if (robots.length < 3) return;
  const [, r2, r3] = robots;

  let r2Busy = false;
  let r3Busy = false;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  // R2: vision-triggered defect rejection.
  simRegistry.tickHooks.push(() => {
    if (r2Busy) return;
    const defectCam = [...simRegistry.objects.values()]
      .find((o) => o.type === 'VisionCamera' && o.opcua?.tag === 'VisionDetect');
    if (!defectCam) return;
    if (!defectCam.params.detecting || defectCam.params.good) return;
    if (!defectCam.params.detectedDefective) return;

    defectCam.root.getWorldPosition(tmpB);
    const target = simRegistry.getObjectsByTypes(['8핀소켓', '12핀소켓'])
      .filter((s) => !s._pickedBy && !s._r2Handled && s.params.defective)
      .find((s) => {
        s.root.getWorldPosition(tmpA);
        const dCam = tmpA.distanceTo(tmpB);
        r2.urdf.getWorldPosition(tmpB);
        const dRobot = tmpA.distanceTo(tmpB);
        defectCam.root.getWorldPosition(tmpB);  // restore for next iteration
        return dCam < 0.45 && dRobot < 0.90;
      });
    if (!target) return;

    target._r2Handled = true;
    r2Busy = true;
    const conv2 = [...simRegistry.objects.values()]
      .find((o) => o.type === 'Conveyor' && o.opcua?.tag === 'Conv2');
    const wasRunning = conv2?.params.running ?? false;
    if (conv2) conv2.params.running = false;
    defectRejectSequence({
      robot: r2, simRegistry, socketToPick: target, t0: 0,
      onComplete: () => {
        r2Busy = false;
        if (conv2 && wasRunning) conv2.params.running = true;
      },
    });
  });

  // R3: tray-stopped weigh+sort.
  simRegistry.tickHooks.push(() => {
    if (r3Busy) return;
    const trays = simRegistry.getObjectsByType('Tray');
    const stopped = trays.find((t) => t._stoppedAtScale && !t._r3Started);
    if (!stopped) return;
    stopped.root.getWorldPosition(tmpA);
    const candidate = simRegistry.getObjectsByTypes(['8핀소켓', '12핀소켓'])
      .filter((s) => !s._pickedBy)
      .find((s) => {
        s.root.getWorldPosition(tmpB);
        return tmpA.distanceTo(tmpB) < 0.30 && tmpB.y > 0.20;
      });
    if (!candidate) return;

    stopped._r3Started = true;
    r3Busy = true;
    weighAndSortSequence({
      robot: r3, simRegistry, socketToPick: candidate, t0: 0,
      onComplete: () => {
        r3Busy = false;
        const sidePusher = [...simRegistry.objects.values()]
          .find((o) => o.type === 'Cylinder' && o.opcua?.tag === 'ScalePusher');
        if (sidePusher) sidePusher.params.running = true;
        setTimeout(() => {
          const conv3 = [...simRegistry.objects.values()]
            .find((o) => o.type === 'Conveyor' && o.opcua?.tag === 'Conv3');
          if (conv3) conv3.params.running = true;
        }, 1500);
      },
    });
  });
}

// Legacy stub: line is now fully event-driven via setupRobotEventLoops.
// Retained so app.js's existing per-order call doesn't error; the only
// useful work it still does is reset gripper jaws so close animations
// have a clean starting state.
export function runWorkCycle({ robotManager }) {
  const robots = robotManager.getAll();
  if (robots.length < 3) return;
  const [r1, r2, r3] = robots;
  r1.openGripper(150);
  r2.openGripper(150);
  r3.openGripper(150);
}
