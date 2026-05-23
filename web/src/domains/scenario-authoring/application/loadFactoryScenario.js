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
import { HOME_POSE } from '../domain/poses.js';
import { _feederState } from '../domain/dispenseQueue.js';
import { loadTraySequence } from './robotChoreography.js';
import { setupRobotEventLoops } from './setupRobotEventLoops.js';

const ROBOT_TYPE = 'indy7';

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
