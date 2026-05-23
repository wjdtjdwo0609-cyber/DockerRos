import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { addEdgesOverlay, EDGE_OPACITY } from '../../../infrastructure/three/index.js';
import { SIM_OBJECT_TYPES } from '../catalog/simObjectTypes.js';
import { buildInspectorUI } from '../presentation/buildInspectorUI.js';

const HIGHLIGHT_COLOR = 0xff9a5a;

export class SimRegistry {
  constructor({
    scene, camera, renderer, orbit, inspectorEl,
    // Optional: function returning an array of Object3D roots (e.g. robots)
    // that should also be raycastable. On hit, onRobotSelect is called.
    extraRootsProvider = null,
    onRobotSelect = null,
    // Optional OpcuaClient — read-bindings update obj.params when tags change;
    // write-bindings push obj.params to the client on change.
    opcuaClient = null,
    // Optional RobotManager — enables sim objects (esp. VisionCamera) to
    // attach themselves to the active robot's TCP link.
    robotManager = null,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.orbit = orbit;
    this.inspectorEl = inspectorEl;
    this.extraRootsProvider = extraRootsProvider;
    this.onRobotSelect = onRobotSelect;
    this.opcuaClient = opcuaClient;
    this.robotManager = robotManager;

    this.objects = new Map();
    this.selected = null;
    this.boxHelper = null;
    this._inspectorRefreshers = [];
    this._inspectorCleanups = [];
    // Per-frame hooks scenario code can register for cross-object glue
    // (e.g. wiring a Sensor's `detected` to a Cylinder's `running`). Called
    // each updateAll(dt). Cleared by scenario load.
    this.tickHooks = [];

    if (opcuaClient) {
      // Read-direction: apply incoming tag updates to bound objects.
      opcuaClient.addEventListener('update', (e) => {
        const { tag, value } = e.detail;
        for (const obj of this.objects.values()) {
          if (obj.opcua?.tag === tag && obj.opcua.direction === 'read' && obj.opcua.paramName) {
            obj.setParam(obj.opcua.paramName, !!value);
          }
        }
      });
    }

    this.transformCtl = new TransformControls(camera, renderer.domElement);
    this.transformCtl.setSize(0.6);
    this.transformCtl.visible = false;
    this.transformCtl.enabled = false;
    // Global gizmo visibility flag. When false, select() still attaches
    // (so dragging would work if re-enabled) but the visible/enabled
    // bits stay off — clean view without losing selection state.
    this._gizmosVisible = true;
    scene.add(this.transformCtl.getHelper ? this.transformCtl.getHelper() : this.transformCtl);
    this.transformCtl.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
    });

    this._raycaster = new THREE.Raycaster();
    this._pointerStart = null;
    this._pointerMoved = false;
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      this._pointerStart = { x: ev.clientX, y: ev.clientY };
      this._pointerMoved = false;
    });
    canvas.addEventListener('pointermove', (ev) => {
      if (!this._pointerStart) return;
      const dx = ev.clientX - this._pointerStart.x;
      const dy = ev.clientY - this._pointerStart.y;
      if (dx * dx + dy * dy > 9) this._pointerMoved = true;
    });
    canvas.addEventListener('pointerup', (ev) => {
      if (ev.button !== 0) return;
      if (!this._pointerMoved && this._pointerStart) this._handleClick(ev);
      this._pointerStart = null;
    });

    inspectorEl.querySelector('[data-insp-close]').addEventListener('click', () => this.deselect());
    inspectorEl.querySelector('[data-insp-delete]').addEventListener('click', () => {
      if (this.selected) this.remove(this.selected.id);
    });
  }

  // Toggle the translate gizmo on the currently selected object. Used by
  // the "축 표시" button to clean up the view without losing selection.
  setGizmosVisible(visible) {
    this._gizmosVisible = visible;
    if (this.selected) {
      this.transformCtl.visible = visible;
      this.transformCtl.enabled = visible;
    }
  }

  _handleClick(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera({ x, y }, this.camera);

    const roots = [];
    for (const obj of this.objects.values()) roots.push(obj.root);
    if (this.extraRootsProvider) roots.push(...this.extraRootsProvider());
    const hits = this._raycaster.intersectObjects(roots, true);

    if (hits.length === 0) { this.deselect(); return; }

    // Walk up from the hit mesh to find either a sim object or a robot.
    let node = hits[0].object;
    while (node) {
      if (node.userData.simObject) {
        this.select(node.userData.simObject);
        return;
      }
      if (node.userData.robotInstance) {
        // Clicking a robot clears any sim selection and delegates to app.js
        // to activate the robot.
        this.deselect();
        if (this.onRobotSelect) this.onRobotSelect(node.userData.robotInstance);
        return;
      }
      node = node.parent;
    }
    this.deselect();
  }

  add(typeName, opts = {}) {
    const Cls = SIM_OBJECT_TYPES[typeName];
    if (!Cls) { console.warn('Unknown sim type:', typeName); return null; }
    const obj = new Cls(opts);
    obj.registry = this;  // so objects can query siblings (e.g. VisionCamera)
    addEdgesOverlay(obj.root);

    // Spawn offset: 4-wide grid, 0.5m spacing — enough to fit most furniture.
    const n = this.objects.size;
    const col = n % 4;
    const row = Math.floor(n / 4);
    obj.root.position.set(0.5 + col * 0.5, 0, row * 0.5 - 0.6);

    this.scene.add(obj.root);
    this.objects.set(obj.id, obj);
    this.select(obj);
    return obj;
  }

  getObjectsByType(type) {
    const out = [];
    for (const o of this.objects.values()) if (o.type === type) out.push(o);
    return out;
  }

  getObjectsByTypes(types) {
    const set = new Set(types);
    const out = [];
    for (const o of this.objects.values()) if (set.has(o.type)) out.push(o);
    return out;
  }

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    if (this.selected?.id === id) this.deselect();
    this.scene.remove(obj.root);
    obj.dispose();
    this.objects.delete(id);
  }

  select(obj) {
    if (this.selected === obj) return;
    this.deselect();
    this.selected = obj;

    // Highlight A: edge lines turn accent color.
    obj.root.traverse((c) => {
      if (!c.userData.isEdgeOverlay) return;
      if (c.userData._origColor === undefined) {
        c.userData._origColor = c.material.color.getHex();
        c.userData._origOpacity = c.material.opacity;
      }
      c.material.color.setHex(HIGHLIGHT_COLOR);
      c.material.opacity = 0.95;
    });

    // Highlight B: axis-aligned bounding box around the whole object.
    this.boxHelper = new THREE.BoxHelper(obj.root, HIGHLIGHT_COLOR);
    this.boxHelper.material.transparent = true;
    this.boxHelper.material.opacity = 0.6;
    this.scene.add(this.boxHelper);

    this.transformCtl.attach(obj.root);
    this.transformCtl.visible = this._gizmosVisible;
    this.transformCtl.enabled = this._gizmosVisible;

    this.inspectorEl.classList.remove('hidden');
    this.inspectorEl.querySelector('[data-insp-title]').textContent = `${obj.type} #${obj.id}`;
    const built = buildInspectorUI(
      this.inspectorEl.querySelector('[data-insp-body]'), obj, this.opcuaClient,
    );
    this._inspectorRefreshers = built.refreshers;
    this._inspectorCleanups = built.cleanups;
  }

  deselect() {
    if (!this.selected) return;
    const obj = this.selected;
    obj.root.traverse((c) => {
      if (!c.userData.isEdgeOverlay) return;
      if (c.userData._origColor !== undefined) {
        c.material.color.setHex(c.userData._origColor);
        c.material.opacity = c.userData._origOpacity ?? EDGE_OPACITY;
      }
    });
    if (this.boxHelper) {
      this.scene.remove(this.boxHelper);
      this.boxHelper.geometry?.dispose();
      this.boxHelper.material?.dispose();
      this.boxHelper = null;
    }
    this.transformCtl.detach();
    this.transformCtl.visible = false;
    this.transformCtl.enabled = false;
    this.selected = null;
    this._inspectorRefreshers = [];
    for (const fn of this._inspectorCleanups) fn();
    this._inspectorCleanups = [];
    this.inspectorEl.classList.add('hidden');
  }

  updateAll(dt) {
    for (const obj of this.objects.values()) obj.update(dt);
    for (const fn of this.tickHooks) fn(dt);
    if (this.boxHelper) this.boxHelper.update();
    for (const r of this._inspectorRefreshers) r();
    // Push write-bound params to OPC UA when they change.
    if (this.opcuaClient && this.opcuaClient.connected) {
      for (const obj of this.objects.values()) {
        const b = obj.opcua;
        if (!b?.tag || b.direction !== 'write' || !b.paramName) continue;
        const v = !!obj.params[b.paramName];
        if (obj._lastSentOpcua !== v) {
          obj._lastSentOpcua = v;
          this.opcuaClient.write(b.tag, v);
        }
      }
    }
  }

  // Flip the `running` param on every object that has one. Sensors and other
  // passive objects are skipped because they don't declare a running state.
  runAll(on) {
    for (const obj of this.objects.values()) {
      if (obj.params.running !== undefined) obj.params.running = !!on;
    }
  }

  anyRunning() {
    for (const obj of this.objects.values()) {
      if (obj.params.running) return true;
    }
    return false;
  }
}
