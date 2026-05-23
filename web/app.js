import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import URDFLoader from 'urdf-loader';
import ROSLIB from 'roslib';
import {
  ROBOT_CONFIG,
  SimRegistry,
  addEdgesOverlay,
  RobotManager,
  OpcuaClient,
  OrderPanel,
  loadFactoryScenario,
  runWorkCycle,
  HOME_POSE,
  runWeldingTest,
  enqueueDispense,
  dispenseQueueLength,
  clearDispenseQueue,
  TrailRenderer,
  installBrowserErrorReporter,
} from './src/public-api/index.js';

installBrowserErrorReporter();

// ── DOM refs ─────────────────────────────────────────────────────────
const viewport = document.getElementById('viewport');
const statusEl = document.getElementById('status');
const jointsEl = document.getElementById('joints');
const jointsHeader = document.getElementById('joints-header');
const robotSelect = document.getElementById('robot-select');
const toolSelect = document.getElementById('tool-select');
const gripperOpenRow = document.getElementById('gripper-open-row');
const gripperOpenInput = document.getElementById('gripper-open');
const gripperOpenVal = document.getElementById('gripper-open-val');
const rosStatus = document.getElementById('ros-status');
const btnRosConnect = document.getElementById('btn-ros-connect');
const btnRosDisconnect = document.getElementById('btn-ros-disconnect');
const btnModeManual = document.getElementById('btn-mode-manual');
const btnModeIK = document.getElementById('btn-mode-ik');
const btnAddRobot = document.getElementById('btn-add-robot');
const btnRemoveRobot = document.getElementById('btn-remove-robot');
const robotListEl = document.getElementById('robot-list');

// ── Scene ────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
const BG_COLOR = 0x0e0e12;
scene.background = new THREE.Color(BG_COLOR);
// Fog fading to background color gives depth cues on large floors and hides
// the grid's edge gracefully (start 8m, fully opaque by 30m).
scene.fog = new THREE.Fog(BG_COLOR, 8, 30);

const camera = new THREE.PerspectiveCamera(
  45, viewport.clientWidth / viewport.clientHeight, 0.01, 200,
);
camera.position.set(1.6, 1.6, 1.6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(3, 5, 4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xbbccff, 0.35);
fill.position.set(-3, 2, -2);
scene.add(fill);

// 20m × 20m floor at 0.5m cells — plenty of room before fog swallows it.
const grid = new THREE.GridHelper(20, 40, 0x3a4050, 0x1e2028);
grid.material.opacity = 0.85;
grid.material.transparent = true;
scene.add(grid);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.3, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
// Lock camera above the floor — factories don't have basement views.
orbit.maxPolarAngle = Math.PI / 2;
orbit.update();

// ── URDF loading ─────────────────────────────────────────────────────
const loader = new URDFLoader();
loader.loadMeshCb = (path, manager, done) => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.stl')) {
    new STLLoader(manager).load(path, (geom) => {
      geom.computeVertexNormals();
      done(new THREE.Mesh(geom, new THREE.MeshPhongMaterial({
        color: 0xbac0c8, specular: 0x222222, shininess: 40,
      })));
    }, undefined, (err) => done(null, err));
  } else if (lower.endsWith('.dae')) {
    new ColladaLoader(manager).load(path, (collada) => done(collada.scene),
      undefined, (err) => done(null, err));
  } else {
    done(null, new Error(`Unsupported mesh: ${path}`));
  }
};

// Multi-robot manager: spawns RobotInstances, tracks active one, handles
// highlight + base-position dragging. app.js wires it to panel UI below.
const robotManager = new RobotManager({
  scene, urdfLoader: loader, robotConfigs: ROBOT_CONFIG,
  camera, renderer, orbit,
});

// Convenience shortcuts — always read through robotManager.active.
function getActive() { return robotManager.active; }

// Tool UI — none / gripper / pen, mutually exclusive. Each delegates to
// the active RobotInstance.
function applyTool(value) {
  const a = getActive();
  if (!a) return;
  if (value === 'gripper') {
    a.attachGripper();
    gripperOpenRow.classList.remove('hidden');
  } else if (value === 'pen') {
    a.attachPen();
    gripperOpenRow.classList.add('hidden');
  } else {
    a.detachGripper();
    a.detachPen();
    gripperOpenRow.classList.add('hidden');
  }
}
toolSelect.addEventListener('change', (e) => applyTool(e.target.value));
gripperOpenInput.addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  gripperOpenVal.textContent = v.toFixed(3);
  getActive()?.setGripperOpening(v);
});

// ── Inverse Kinematics (CCD solver) ─────────────────────────────────
// A simple iterative CCD solver on the URDF joint chain. Works for 6-7 DOF arms.
const ikTarget = new THREE.Mesh(
  new THREE.SphereGeometry(0.03, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xff9a5a, transparent: true, opacity: 0.75 }),
);
ikTarget.visible = false;
scene.add(ikTarget);

const transformCtl = new TransformControls(camera, renderer.domElement);
transformCtl.setSize(0.6);
transformCtl.attach(ikTarget);
transformCtl.visible = false;
transformCtl.enabled = false;
scene.add(transformCtl.getHelper ? transformCtl.getHelper() : transformCtl);

// disable orbit while dragging target
transformCtl.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
});

function solveIK() {
  const active = getActive();
  if (!active) return;
  const { urdf, cfg } = active;
  const chain = cfg.chain.map((n) => urdf.joints[n]).filter(Boolean);
  const tcp = urdf.links[cfg.tcp];
  if (!tcp || chain.length === 0) return;

  const targetWorld = new THREE.Vector3();
  ikTarget.getWorldPosition(targetWorld);

  const iterations = 8;
  for (let it = 0; it < iterations; it++) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const joint = chain[i];
      joint.updateMatrixWorld(true);
      tcp.updateMatrixWorld(true);

      const jointPos = new THREE.Vector3().setFromMatrixPosition(joint.matrixWorld);
      const tcpPos = new THREE.Vector3().setFromMatrixPosition(tcp.matrixWorld);

      const toEnd = new THREE.Vector3().subVectors(tcpPos, jointPos);
      const toTarget = new THREE.Vector3().subVectors(targetWorld, jointPos);
      if (toEnd.lengthSq() < 1e-9 || toTarget.lengthSq() < 1e-9) continue;
      toEnd.normalize();
      toTarget.normalize();

      const axisWorld = new THREE.Vector3().crossVectors(toEnd, toTarget);
      if (axisWorld.lengthSq() < 1e-9) continue;
      axisWorld.normalize();
      let angle = Math.acos(THREE.MathUtils.clamp(toEnd.dot(toTarget), -1, 1));
      angle *= 0.5;

      const jointAxisWorld = new THREE.Vector3(
        joint.axis.x, joint.axis.y, joint.axis.z,
      ).transformDirection(joint.parent.matrixWorld);
      const signedAngle = angle * axisWorld.dot(jointAxisWorld);

      let newVal = (joint.angle ?? 0) + signedAngle;
      if (Number.isFinite(joint.limit.lower) && Number.isFinite(joint.limit.upper)) {
        newVal = THREE.MathUtils.clamp(newVal, joint.limit.lower, joint.limit.upper);
      }
      active.setJointValue(joint.name, newVal);
    }
  }
}

// ── Mode handling ────────────────────────────────────────────────────
// `mode` is a single global — user is in either manual or IK mode at any time.
// It applies to whichever robot is currently active.
let mode = 'manual';
function setMode(m) {
  mode = m;
  const ikOn = m === 'ik';
  ikTarget.visible = ikOn;
  transformCtl.visible = ikOn;
  transformCtl.enabled = ikOn;
  btnModeManual.classList.toggle('active', !ikOn);
  btnModeIK.classList.toggle('active', ikOn);
  // IK mode hides the base-position gizmo to avoid two gizmos fighting for clicks.
  robotManager.setPositionGizmoVisible(!ikOn);
  if (ikOn) parkTargetAtTCP();
}
btnModeManual.addEventListener('click', () => setMode('manual'));
btnModeIK.addEventListener('click', () => setMode('ik'));

function parkTargetAtTCP() {
  const active = getActive();
  if (!active) return;
  const tcp = active.urdf.links[active.cfg.tcp];
  if (!tcp) return;
  tcp.updateMatrixWorld(true);
  ikTarget.position.setFromMatrixPosition(tcp.matrixWorld);
}

// ── Active-robot panel refresh ──────────────────────────────────────
function refreshActivePanel(active) {
  jointsEl.innerHTML = '';
  if (!active) {
    jointsHeader.textContent = '관절 (로봇 없음)';
    toolSelect.value = 'none';
    toolSelect.disabled = true;
    gripperOpenRow.classList.add('hidden');
    btnRemoveRobot.disabled = true;
    return;
  }
  toolSelect.disabled = false;
  btnRemoveRobot.disabled = false;
  buildJointUI(active);
  // Sync tool selector with the robot's current tool state.
  toolSelect.value = active.gripperGroup ? 'gripper'
                   : active.penGroup     ? 'pen'
                   : 'none';
  gripperOpenRow.classList.toggle('hidden', !active.gripperGroup);
  if (mode === 'ik') parkTargetAtTCP();
  statusEl.textContent = `✓ 활성: ${active.type} #${active.id} — ${Object.keys(active.sliders).length}개 관절 | 전체 ${robotManager.robots.size}대`;
  syncTestPanel();   // 디지털 트윈 테스트 패널을 활성 로봇 배치값으로 동기화
}

function refreshRobotList() {
  robotListEl.innerHTML = '';
  const all = robotManager.getAll();
  if (all.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'small muted';
    empty.textContent = '로봇 없음';
    robotListEl.appendChild(empty);
    return;
  }
  for (const r of all) {
    const row = document.createElement('div');
    row.className = 'robot-row';
    if (r.id === robotManager.activeId) row.classList.add('active');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'robot-row-name';
    nameSpan.textContent = `${r.type} #${r.id}`;
    const delBtn = document.createElement('button');
    delBtn.className = 'robot-row-del';
    delBtn.textContent = '×';
    delBtn.title = '제거';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      robotManager.remove(r.id);
    });
    row.appendChild(nameSpan);
    row.appendChild(delBtn);
    row.addEventListener('click', () => robotManager.setActive(r.id));
    robotListEl.appendChild(row);
  }
}

robotManager.onActiveChange = (active) => refreshActivePanel(active);
robotManager.onListChange = () => refreshRobotList();

function buildJointUI(active) {
  const { urdf, sliders } = active;
  jointsHeader.textContent = `관절 (${Object.keys(urdf.joints).length}개)`;
  Object.keys(sliders).forEach((k) => delete sliders[k]);
  for (const [name, joint] of Object.entries(urdf.joints)) {
    if (joint.jointType === 'fixed' || joint.jointType === 'unknown') continue;

    const lower = Number.isFinite(joint.limit.lower) ? joint.limit.lower : -Math.PI;
    const upper = Number.isFinite(joint.limit.upper) ? joint.limit.upper : Math.PI;
    const value = joint.angle ?? 0;

    const row = document.createElement('div');
    row.className = 'joint';
    row.innerHTML = `
      <div class="joint-label">
        <span class="joint-name">${name}</span>
        <span class="joint-value">${value.toFixed(2)}</span>
      </div>
      <input type="range" min="${lower}" max="${upper}" step="0.01" value="${value}">
    `;
    const input = row.querySelector('input');
    const valLabel = row.querySelector('.joint-value');
    input.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      active.setJointValue(name, v);
    });
    jointsEl.appendChild(row);
    sliders[name] = { input, valLabel };
  }
}

// Home / Zero pose buttons. Both animate (1.2s eased) instead of snapping
// so the user gets visual feedback and the joint sliders sweep smoothly.
document.getElementById('btn-home-pose').addEventListener('click', () => {
  const a = getActive();
  if (a) a.animateToPose(HOME_POSE, 1200);
});
document.getElementById('btn-reset').addEventListener('click', () => {
  const a = getActive();
  if (!a) return;
  const zero = {};
  for (const name of Object.keys(a.urdf.joints)) {
    const j = a.urdf.joints[name];
    if (j.jointType !== 'fixed' && j.jointType !== 'unknown') zero[name] = 0;
  }
  a.animateToPose(zero, 1200);
});
btnAddRobot.addEventListener('click', () => {
  statusEl.textContent = `로딩 중: ${robotSelect.value}…`;
  robotManager.add(robotSelect.value).catch((err) => {
    console.error(err);
    statusEl.textContent = `❌ ${err?.message || err}`;
  });
});
btnRemoveRobot.addEventListener('click', () => {
  if (robotManager.activeId != null) robotManager.remove(robotManager.activeId);
});

// ── Camera: presets + focus-on-selection with easing ────────────────
const VIEW_PRESETS = {
  iso:   { pos: [1.6, 1.6, 1.6],  target: [0, 0.3, 0] },
  top:   { pos: [0,   3.5, 0.001], target: [0, 0, 0] },
  front: { pos: [0,   0.6, 2.8],  target: [0, 0.5, 0] },
  side:  { pos: [2.8, 0.6, 0],    target: [0, 0.5, 0] },
};

let _camAnim = null; // { startTime, duration, fromCam, toCam, fromTarget, toTarget }

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function startCameraMove(toCameraPos, toTargetPos, duration = 450) {
  _camAnim = {
    startTime: performance.now(),
    duration,
    fromCam: camera.position.clone(),
    toCam: toCameraPos.clone(),
    fromTarget: orbit.target.clone(),
    toTarget: toTargetPos.clone(),
  };
}

function stepCameraAnim() {
  if (!_camAnim) return;
  const t = Math.min((performance.now() - _camAnim.startTime) / _camAnim.duration, 1);
  const e = easeInOutQuad(t);
  camera.position.lerpVectors(_camAnim.fromCam, _camAnim.toCam, e);
  orbit.target.lerpVectors(_camAnim.fromTarget, _camAnim.toTarget, e);
  if (t >= 1) _camAnim = null;
}

function applyPreset(name) {
  const p = VIEW_PRESETS[name];
  if (!p) return;
  startCameraMove(new THREE.Vector3(...p.pos), new THREE.Vector3(...p.target));
}

function focusOn(object3D) {
  if (!object3D) return;
  const box = new THREE.Box3().setFromObject(object3D);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  // Keep current view direction, but reframe at a distance proportional to object size.
  const dir = new THREE.Vector3().subVectors(camera.position, orbit.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 1, 1);
  dir.normalize();
  const distance = Math.max(size * 1.8, 0.6);
  const newCamPos = new THREE.Vector3().copy(center).addScaledVector(dir, distance);
  startCameraMove(newCamPos, center);
}

document.querySelectorAll('#panel [data-view]').forEach((btn) => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.view));
});
function _currentFocusTarget() {
  return simRegistry.selected?.root ?? getActive()?.urdf ?? null;
}

document.getElementById('btn-focus').addEventListener('click', () => {
  focusOn(_currentFocusTarget());
});

// F key = focus. Ignore when typing in form fields.
window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'f' && ev.key !== 'F') return;
  const tag = ev.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  focusOn(_currentFocusTarget());
});

// ── Arrow-key camera pan (2D / floor plane only) ───────────────────
// ↑↓←→ (or WASD) slide the camera + orbit target across the horizontal
// plane only. Vertical lift / zoom is left to the trackpad
// (OrbitControls scroll/pinch). Shift = 3× speed.
const _keysHeld = new Set();
// All keys normalized to lowercase ('arrowleft', 'a', …) so the
// keydown / keyup / applyKeyboardPan code paths see identical strings.
const _PAN_KEYS = new Set([
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'w', 'a', 's', 'd',
]);
let _shiftHeld = false;
window.addEventListener('keydown', (ev) => {
  const tag = ev.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (ev.key === 'Shift') _shiftHeld = true;
  const k = ev.key.toLowerCase();
  if (_PAN_KEYS.has(k)) {
    _keysHeld.add(k);
    ev.preventDefault();
  }
});
window.addEventListener('keyup', (ev) => {
  if (ev.key === 'Shift') _shiftHeld = false;
  _keysHeld.delete(ev.key.toLowerCase());
});
// Stop sliding if focus leaves the window mid-press (sticky-key bug).
window.addEventListener('blur', () => { _keysHeld.clear(); _shiftHeld = false; });

const _PAN_WORLD_UP = new THREE.Vector3(0, 1, 0);
const _panForward = new THREE.Vector3();
const _panRight   = new THREE.Vector3();
const _panDelta   = new THREE.Vector3();
function applyKeyboardPan(dt) {
  if (_keysHeld.size === 0) return;
  if (_camAnim) return;     // don't fight an active preset/focus animation
  const speed = 1.5 * (_shiftHeld ? 3 : 1) * dt; // m/s × dt

  // Camera's look direction projected onto the ground plane gives the
  // "forward" axis on the floor. If the camera looks straight down (top
  // preset) the projection collapses — fall back to world -Z.
  _panForward.subVectors(orbit.target, camera.position);
  _panForward.y = 0;
  if (_panForward.lengthSq() < 1e-6) _panForward.set(0, 0, -1);
  _panForward.normalize();
  // Right axis = forward × up (always horizontal because forward is).
  _panRight.crossVectors(_panForward, _PAN_WORLD_UP).normalize();

  _panDelta.set(0, 0, 0);
  if (_keysHeld.has('arrowleft')  || _keysHeld.has('a')) _panDelta.addScaledVector(_panRight,   -speed);
  if (_keysHeld.has('arrowright') || _keysHeld.has('d')) _panDelta.addScaledVector(_panRight,    speed);
  if (_keysHeld.has('arrowup')    || _keysHeld.has('w')) _panDelta.addScaledVector(_panForward,  speed);
  if (_keysHeld.has('arrowdown')  || _keysHeld.has('s')) _panDelta.addScaledVector(_panForward, -speed);
  if (_panDelta.lengthSq() > 0) {
    camera.position.add(_panDelta);
    orbit.target.add(_panDelta);
  }
}

// Double-click on canvas = focus on whatever was hit (sim object or robot).
renderer.domElement.addEventListener('dblclick', (ev) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  const rc = new THREE.Raycaster();
  rc.setFromCamera({ x, y }, camera);
  const roots = [];
  for (const o of simRegistry.objects.values()) roots.push(o.root);
  for (const r of robotManager.getAll()) roots.push(r.urdf);
  const hits = rc.intersectObjects(roots, true);
  if (hits.length === 0) return;
  // Walk up to the sim-object or robot root, whichever matches first.
  let node = hits[0].object;
  while (node && !node.userData.simObject && !node.userData.robotInstance) {
    node = node.parent;
  }
  focusOn(node ?? hits[0].object);
});

// ── ROS2 live sync (rosbridge) ───────────────────────────────────────
let ros = null;
let jointSubs = [];

// Phase 3: live-mirror priority. _mirrorActive[cid] = last time (ms) a real
// /<cid>/joint_states frame drove that arm. While fresh, the taught scenario
// for that class is skipped so it doesn't fight the live joints. This only
// gates *playing* the scenario — the taught/captured data is never modified.
const _mirrorActive = {};
const MIRROR_FRESH_MS = 1500;
function _anyMirrorActive() {
  const now = Date.now();
  return Object.values(_mirrorActive).some((t) => now - t < MIRROR_FRESH_MS);
}
function _applyJointState(robot, msg) {
  for (let i = 0; i < msg.name.length; i++) {
    if (robot.urdf.joints[msg.name[i]]) {
      robot.setJointValue(msg.name[i], msg.position[i]);
    }
  }
}

btnRosConnect.addEventListener('click', () => {
  const url = 'ws://localhost:9090';
  rosStatus.textContent = `연결 중… ${url}`;
  rosStatus.className = 'small muted';

  ros = new ROSLIB.Ros({ url });

  ros.on('connection', () => {
    rosStatus.textContent = `✓ 연결됨 (${url}) — /joint_states 구독`;
    rosStatus.className = 'small connected';
    btnRosConnect.disabled = true;
    btnRosDisconnect.disabled = false;

    // Per-robot topics: /<cid>/joint_states drives exactly the arm tagged
    // with that cid (set by loadFactoryScenario). This is the real-line
    // mirror — independent r1/r2/r3.
    for (const cid of ['r1', 'r2', 'r3']) {
      const sub = new ROSLIB.Topic({
        ros, name: `/${cid}/joint_states`,
        messageType: 'sensor_msgs/msg/JointState',
      });
      sub.subscribe((msg) => {
        const target = robotManager.getAll()
          .find((r) => r.urdf.userData && r.urdf.userData.cid === cid);
        if (!target) return;
        _applyJointState(target, msg);
        _mirrorActive[cid] = Date.now();
      });
      jointSubs.push(sub);
    }

    // Shared /joint_states: back-compat for single-robot / untagged scenes.
    // Skips arms already driven by a fresh per-robot stream so the two
    // never fight.
    const sharedSub = new ROSLIB.Topic({
      ros, name: '/joint_states', messageType: 'sensor_msgs/msg/JointState',
    });
    sharedSub.subscribe((msg) => {
      for (const r of robotManager.getAll()) {
        const cid = r.urdf.userData && r.urdf.userData.cid;
        // cid 태그된 라인 로봇(r1/r2/r3)은 per-robot 토픽만 따른다.
        // shared /joint_states 를 같이 적용하면 로봇이 멈춘 직후 per-robot
        // 스트림이 잠깐 끊길 때 shared 가 끼어들어 포즈가 튄다 → 무시.
        if (cid) continue;
        _applyJointState(r, msg);
      }
    });
    jointSubs.push(sharedSub);
  });

  ros.on('error', (err) => {
    rosStatus.textContent = `❌ 에러: rosbridge 실행 중인지 확인 (scripts/run-rosbridge.sh)`;
    rosStatus.className = 'small error';
    console.error(err);
  });
  ros.on('close', () => {
    rosStatus.textContent = '연결 종료';
    rosStatus.className = 'small muted';
    btnRosConnect.disabled = false;
    btnRosDisconnect.disabled = true;
  });
});

btnRosDisconnect.addEventListener('click', () => {
  for (const s of jointSubs) {
    try { s.unsubscribe(); } catch (_) { /* ignore */ }
  }
  jointSubs = [];
  if (ros) ros.close();
  ros = null;
});

// ── Sim objects (conveyors / cylinders / sensors) ───────────────────
// OPC UA: browser client for the opcua_ws_adapter.py bridge. Starts
// connecting immediately; sim objects can be bound to PLC tags via the
// inspector dropdown whether or not it's currently up.
const opcuaClient = new OpcuaClient();
const opcuaStatusEl = document.getElementById('opcua-status');
function syncOpcuaStatus() {
  if (!opcuaStatusEl) return;
  if (opcuaClient.connected) {
    opcuaStatusEl.textContent = `✓ 연결됨 — ${opcuaClient.catalog.length}개 태그`;
    opcuaStatusEl.className = 'small connected';
  } else {
    opcuaStatusEl.textContent = '미연결 — `OPC UA 어댑터.command` 실행 필요';
    opcuaStatusEl.className = 'small muted';
  }
}
opcuaClient.addEventListener('status', syncOpcuaStatus);
opcuaClient.addEventListener('catalog', syncOpcuaStatus);
syncOpcuaStatus();

const simRegistry = new SimRegistry({
  scene, camera, renderer, orbit,
  inspectorEl: document.getElementById('inspector'),
  extraRootsProvider: () => robotManager.getAll().map((r) => r.urdf),
  onRobotSelect: (robotInstance) => robotManager.setActive(robotInstance.id),
  opcuaClient,
  robotManager,
});

document.querySelectorAll('#sim-toolbar [data-sim-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    simRegistry.add(btn.dataset.simAdd);
  });
});

// ── Trail (pen-tool path visualization) ───────────────────────────────
const trail = new TrailRenderer(scene, { maxPoints: 8000, color: 0xff9a5a });
const btnTrailToggle = document.getElementById('btn-trail-toggle');
const btnTrailClear  = document.getElementById('btn-trail-clear');
function syncTrailButton() {
  btnTrailToggle.textContent = trail.enabled ? '📍 트레일 ON' : '📍 트레일 OFF';
  btnTrailToggle.classList.toggle('active', trail.enabled);
}
btnTrailToggle.addEventListener('click', () => {
  trail.setEnabled(!trail.enabled);
  syncTrailButton();
});
btnTrailClear.addEventListener('click', () => trail.clear());
syncTrailButton();
const _trailTipTmp = new THREE.Vector3();

// ── Welding test runner — toggle button (run / stop) ────────────────
const btnWeldingTest = document.getElementById('btn-welding-test');
let _weldingAbortCtl = null;

function setWeldingButtonRunning(on) {
  btnWeldingTest.textContent = on ? '⏹ 용접 테스트 정지' : '🧪 용접 테스트 실행';
  btnWeldingTest.classList.toggle('active', on);
}

btnWeldingTest.addEventListener('click', async () => {
  // If a test is already running, this click is a stop request.
  if (_weldingAbortCtl) {
    _weldingAbortCtl.abort();
    return;
  }
  const a = getActive();
  if (!a) { statusEl.textContent = '❌ 활성 로봇 없음'; return; }
  if (!a.penGroup) { a.attachPen(); toolSelect.value = 'pen'; }
  trail.clear();
  trail.setEnabled(true);
  syncTrailButton();

  _weldingAbortCtl = new AbortController();
  setWeldingButtonRunning(true);
  try {
    await runWeldingTest(a, {
      log: (s) => { statusEl.textContent = s; },
      signal: _weldingAbortCtl.signal,
    });
    statusEl.textContent = '✓ 용접 테스트 완료';
  } catch (err) {
    if (err?.name === 'AbortError') {
      statusEl.textContent = '⏹ 용접 테스트 중단됨';
    } else {
      console.error(err);
      statusEl.textContent = `❌ 테스트 실패: ${err?.message || err}`;
    }
  } finally {
    _weldingAbortCtl = null;
    setWeldingButtonRunning(false);
  }
});

const btnRunAll = document.getElementById('btn-run-all');
function syncRunAllLabel() {
  const on = simRegistry.anyRunning();
  btnRunAll.textContent = on ? '⏸ 전체 정지' : '▶ 전체 실행';
  btnRunAll.classList.toggle('active', on);
}
btnRunAll.addEventListener('click', () => {
  const turnOn = !simRegistry.anyRunning();
  if (!turnOn) {
    // STOP requested. The cylinder's running flag is driven by a tick
    // hook (sensor.detected && !r1Busy), so flipping its `running`
    // directly via runAll() bounces back instantly. Clear the queue +
    // sensor so the tick hook agrees that the feeder is idle. Also
    // drain in-flight order polling timers.
    clearDispenseQueue();
    for (const demo of _orderDemos.values()) {
      if (demo.intervalId) clearInterval(demo.intervalId);
    }
    _orderDemos.clear();
  }
  simRegistry.runAll(turnOn);
  syncRunAllLabel();
});

// Order panel — local-test stand-in for the eventual web order intake.
const orderPanel = new OrderPanel(document.getElementById('order-panel'));
document.getElementById('btn-toggle-orders').addEventListener('click', () => {
  orderPanel.toggle();
});

// Auto-demo: when an order is submitted, spawn the requested sockets at the
// start of Conv1, set the weight-scale's expected weight, turn on every
// conveyor, and watch for the sockets to reach the scale region. This is a
// purely visual stand-in for what would normally be PLC-driven robot motion.
const _orderDemos = new Map();  // orderId → { intervalId, socketIds }
orderPanel.addEventListener('orders-changed', () => {
  for (const order of orderPanel.active) {
    if (_orderDemos.has(order.id)) continue;  // already running
    _orderDemos.set(order.id, startOrderDemo(order));
  }
  // Cleanup demos for orders no longer active.
  for (const id of [..._orderDemos.keys()]) {
    if (!orderPanel.active.find((o) => o.id === id)) {
      const demo = _orderDemos.get(id);
      if (demo?.intervalId) clearInterval(demo.intervalId);
      _orderDemos.delete(id);
    }
  }
});

function startOrderDemo(order) {
  const conv1 = [...simRegistry.objects.values()]
    .find((o) => o.type === 'Conveyor' && o.opcua?.tag === 'Conv1');
  const scale = simRegistry.getObjectsByType('WeightScale')[0];
  if (!conv1) return { intervalId: null, socketIds: [] };

  // Set scale expected weight from the order.
  if (scale) {
    const expected = order.socket8 * scale.params.socket8Weight
                   + order.socket12 * scale.params.socket12Weight;
    scale.setParam('expectedWeight', expected);
  }

  // Each order = one TRAY. Build the socket list to load onto the tray
  // and push as a single order entry. The scenario's cylinder dispenses
  // the empty tray on Conv1 (Conv1 pauses), R1 then picks each socket
  // from the magazine and places it on a slot, sockets get re-parented
  // under the tray so they ride with it, then Conv1 resumes.
  const sockets = [];
  for (let k = 0; k < order.socket8;  k++) sockets.push({ type: 'Socket8'  });
  for (let k = 0; k < order.socket12; k++) sockets.push({ type: 'Socket12' });
  enqueueDispense([{ orderId: order.id, sockets }]);
  simRegistry.deselect();
  const socketIds = [];

  // Turn on conveyors + elevator so the sockets actually travel.
  simRegistry.runAll(true);

  // Animate the 3 robots through their pick/inspect/stack cycle. Each robot
  // actually re-parents a real socket under its gripper at pick time and
  // drops it back at place time, so items move with the arms.
  runWorkCycle({
    simRegistry,
    robotManager,
    hasOrderWith8: order.socket8 > 0,
    hasOrderWith12: order.socket12 > 0,
  });

  // Poll the order's TRAY (not individual sockets). The order is "done"
  // once the tray for THIS order has been spawned (cylinder fired) AND
  // its world X has reached the scale line. Sockets ride parented under
  // the tray, so they move with it. Safety timeout 120s — loading +
  // travel can take a while for big orders.
  const arrivedX = scale ? scale.root.position.x - 0.05 : 1.45;
  const startedAt = performance.now();
  const intervalId = setInterval(() => {
    if (!orderPanel.active.find((o) => o.id === order.id)) {
      clearInterval(intervalId);
      return;
    }
    const myTray = [...simRegistry.objects.values()]
      .find((o) => o.type === 'Tray' && o._fromOrder === order.id);
    // Cylinder hasn't dispensed yet (R1 was busy with a previous order
    // or the queue is still draining). Keep waiting.
    if (!myTray) return;
    const trayWorldX = myTray.root.position.x; // Tray is in scene root
    if (trayWorldX >= arrivedX) {
      orderPanel.markDone(order.id);
      clearInterval(intervalId);
      return;
    }
    if (performance.now() - startedAt > 120000) {
      console.warn('[demo] order', order.id, 'timed out');
      clearInterval(intervalId);
    }
  }, 250);

  return { intervalId, socketIds };
}

// ── Digital-twin dispatch hook ──────────────────────────────────────────
// Called by socket_picking_bridge.js when the REAL line processes one part
// (8pin/12pin). Synthesizes a one-socket order and runs it through the exact
// same path as the order panel, so the sim robots play that class's
// predetermined scenario once. Additive — no existing behavior changed.
window.__twinDispatch = () => {
  // 시나리오 재생 비활성화 — 시뮬 로봇은 라이브 미러(/joint_states)로만 동작한다.
  // 실제 라인 DONE 이벤트로 시나리오를 재생하면 라이브 미러와 충돌해
  // 로봇이 멈춘 직후 포즈가 튀므로, 재생을 끄고 미러만 사용한다.
  return;
};

// Auto-demo: every ~10s submit a random order so the line keeps flowing on
// its own. Skip if too many orders are already in flight to avoid pile-ups.
let _autoDemoTimer = null;
const btnAutoDemo = document.getElementById('btn-auto-demo');
function submitRandomOrder() {
  if (orderPanel.active.length >= 2) return;
  // One pick-place cycle handles a single socket; submit 1 of one type
  // per order so the cycle visually completes the order each time.
  const which = Math.random() < 0.5 ? 'socket8' : 'socket12';
  orderPanel.submit({
    socket8:  which === 'socket8'  ? 1 : 0,
    socket12: which === 'socket12' ? 1 : 0,
  });
}
function setAutoDemo(on) {
  if (on && !_autoDemoTimer) {
    submitRandomOrder();
    _autoDemoTimer = setInterval(submitRandomOrder, 18000);
    btnAutoDemo.textContent = '⏸ 자동 테스트 정지';
    btnAutoDemo.classList.add('active');
  } else if (!on && _autoDemoTimer) {
    clearInterval(_autoDemoTimer);
    _autoDemoTimer = null;
    btnAutoDemo.textContent = '🎲 자동 테스트';
    btnAutoDemo.classList.remove('active');
    // Stop pending dispenses too — otherwise the operator presses STOP
    // but the cylinder keeps cycling for queued orders.
    clearDispenseQueue();
    for (const demo of _orderDemos.values()) {
      if (demo.intervalId) clearInterval(demo.intervalId);
    }
    _orderDemos.clear();
  }
}
btnAutoDemo.addEventListener('click', () => setAutoDemo(!_autoDemoTimer));

// 축 표시 토글: SimRegistry의 select gizmo + RobotManager의 base gizmo를
// 함께 켜고 끔. 깔끔한 화면이 필요할 때 한 번 누르면 둘 다 사라짐.
let _axesVisible = true;
const btnToggleAxes = document.getElementById('btn-toggle-axes');
btnToggleAxes.addEventListener('click', () => {
  _axesVisible = !_axesVisible;
  simRegistry.setGizmosVisible(_axesVisible);
  robotManager.setGizmosVisible(_axesVisible);
  btnToggleAxes.textContent = _axesVisible ? '🧭 축 표시' : '🧭 축 숨김';
  btnToggleAxes.classList.toggle('active', !_axesVisible);
});

// Scenario loader — clears scene, builds the 3-robot socket sorting line.
document.getElementById('btn-load-scenario').addEventListener('click', () => {
  // Drop any in-flight demos before the scene rebuilds.
  for (const demo of _orderDemos.values()) {
    if (demo.intervalId) clearInterval(demo.intervalId);
  }
  _orderDemos.clear();
  setAutoDemo(false); // stop auto-test, scenario re-init shouldn't keep firing orders
  loadFactoryScenario({ simRegistry, robotManager, statusEl, orderPanel })
    .catch((err) => {
      console.error('[scenario]', err);
      statusEl.textContent = `❌ 시나리오 실패: ${err?.message || err}`;
    });
});

// ── 디지털 트윈 플로팅 테스트 버튼 ───────────────────────────────────────
// 시나리오 로드 + 주문 무한 반복을 한 버튼으로. embed 모드(#panel/툴바 숨김)
// 에서도 보이도록 viewport 위에 떠 있는 버튼. 다시 누르면 정지.
const twinTestBtn = document.getElementById('twin-test-btn');
let _twinTestRunning = false;
if (twinTestBtn) {
  twinTestBtn.addEventListener('click', async () => {
    // 이미 실행 중이면 정지.
    if (_twinTestRunning) {
      setAutoDemo(false);
      _twinTestRunning = false;
      twinTestBtn.textContent = '🏭 시나리오 테스트';
      twinTestBtn.classList.remove('running');
      statusEl.textContent = '⏹ 시나리오 테스트 정지';
      return;
    }
    // 시작: 시나리오 로드 → 주문 무한 반복.
    _twinTestRunning = true;
    twinTestBtn.disabled = true;
    twinTestBtn.textContent = '⏳ 로딩…';
    for (const demo of _orderDemos.values()) {
      if (demo.intervalId) clearInterval(demo.intervalId);
    }
    _orderDemos.clear();
    setAutoDemo(false);
    try {
      await loadFactoryScenario({ simRegistry, robotManager, statusEl, orderPanel });
      setAutoDemo(true);                       // 주문 무한 반복 시작
      twinTestBtn.textContent = '⏹ 테스트 정지';
      twinTestBtn.classList.add('running');
      statusEl.textContent = '🏭 시나리오 테스트 — 주문 무한 반복 중';
    } catch (err) {
      console.error('[twin-test]', err);
      statusEl.textContent = `❌ 시나리오 실패: ${err?.message || err}`;
      _twinTestRunning = false;
      twinTestBtn.textContent = '🏭 시나리오 테스트';
    } finally {
      twinTestBtn.disabled = false;
    }
  });
}

// ── Resize + animate loop ────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

const clock = new THREE.Clock();
(function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  stepCameraAnim();
  applyKeyboardPan(dt);
  orbit.update();
  if (mode === 'ik' && getActive()) solveIK();
  simRegistry.updateAll(dt);
  robotManager.tick();
  // Sample tool tip of every robot with an attached tool so the trail
  // captures motion regardless of which robot is "active".
  if (trail.enabled) {
    for (const r of robotManager.getAll()) {
      const wp = r.getToolTipWorld(_trailTipTmp);
      if (wp) trail.addPoint(wp);
    }
  }
  syncRunAllLabel();
  renderer.render(scene, camera);
})();

// ── 디지털 트윈 테스트 패널 ──────────────────────────────────────────────
// 활성 로봇의 베이스 배치(yaw 회전 + XYZ 위치)를 라이브로 조정 + 360° 회전 테스트.
// 시뮬 표시 전용 — urdf.rotation/position 만 건드리며 관절/relay 와 무관.
const testYaw    = document.getElementById('test-yaw');
const testYawVal = document.getElementById('test-yaw-val');
const testPx     = document.getElementById('test-px');
const testPy     = document.getElementById('test-py');
const testPz     = document.getElementById('test-pz');
const btnTestSpin = document.getElementById('btn-test-spin');
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
let _spinJob = null;

// 활성 로봇의 현재 배치값을 입력칸에 반영.
function syncTestPanel() {
  const a = getActive();
  if (!a || !a.urdf || !testYaw) return;
  const yawDeg = Math.round(a.urdf.rotation.z * R2D);
  testYaw.value = yawDeg;
  testYawVal.textContent = yawDeg;
  testPx.value = a.urdf.position.x.toFixed(2);
  testPy.value = a.urdf.position.y.toFixed(2);
  testPz.value = a.urdf.position.z.toFixed(2);
}

// yaw 슬라이더 → 메인축(z) 회전 라이브 적용.
testYaw.addEventListener('input', () => {
  testYawVal.textContent = testYaw.value;
  const a = getActive();
  if (a && a.urdf) a.urdf.rotation.z = parseFloat(testYaw.value) * D2R;
});

// XYZ 위치 입력 → 라이브 적용.
function bindTestPos(input, axis) {
  input.addEventListener('input', () => {
    const a = getActive();
    const v = parseFloat(input.value);
    if (a && a.urdf && Number.isFinite(v)) a.urdf.position[axis] = v;
  });
}
bindTestPos(testPx, 'x');
bindTestPos(testPy, 'y');
bindTestPos(testPz, 'z');

document.getElementById('btn-test-sync').addEventListener('click', syncTestPanel);

// 테스트 회전: 활성 로봇을 메인축 기준 360° 한 바퀴 (2.5s) 돌렸다 원위치.
btnTestSpin.addEventListener('click', () => {
  if (_spinJob) { _spinJob = null; btnTestSpin.textContent = '🧪 테스트 회전'; return; }
  const a = getActive();
  if (!a || !a.urdf) { statusEl.textContent = '❌ 활성 로봇 없음'; return; }
  const start = a.urdf.rotation.z;
  const dur = 2500, t0 = performance.now();
  const job = {};
  _spinJob = job;
  btnTestSpin.textContent = '⏹ 회전 정지';
  function step(now) {
    if (_spinJob !== job) { a.urdf.rotation.z = start; syncTestPanel(); return; }
    const t = Math.min(1, (now - t0) / dur);
    a.urdf.rotation.z = start + t * Math.PI * 2;
    const liveDeg = Math.round(a.urdf.rotation.z * R2D) % 360;
    testYaw.value = liveDeg;
    testYawVal.textContent = liveDeg;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      a.urdf.rotation.z = start;          // 한 바퀴 후 원위치
      _spinJob = null;
      btnTestSpin.textContent = '🧪 테스트 회전';
      syncTestPanel();
      statusEl.textContent = '🧪 테스트 회전 완료';
    }
  }
  requestAnimationFrame(step);
});

// Bootstrap: spawn one robot of the default type so the scene isn't empty.
refreshRobotList();
refreshActivePanel(null);
robotManager.add(robotSelect.value).catch((err) => {
  console.error(err);
  statusEl.textContent = `❌ ${err?.message || err}`;
});
