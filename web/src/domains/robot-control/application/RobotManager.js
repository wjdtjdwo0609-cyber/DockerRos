import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { addEdgesOverlay } from '../../../infrastructure/three/addEdgesOverlay.js';
import { RobotInstance } from './RobotInstance.js';

const HIGHLIGHT_COLOR = 0xff9a5a;

export class RobotManager {
  constructor({ scene, urdfLoader, robotConfigs, camera, renderer, orbit }) {
    this.scene = scene;
    this.loader = urdfLoader;
    this.configs = robotConfigs;
    this.camera = camera;
    this.renderer = renderer;
    this.orbit = orbit;

    this.robots = new Map();
    this.activeId = null;
    this.boxHelper = null;

    // Callbacks set by app.js
    this.onActiveChange = () => {};
    this.onListChange = () => {};

    // TransformControls for dragging active robot base.
    this.transformCtl = new TransformControls(camera, renderer.domElement);
    this.transformCtl.setSize(0.8);
    this.transformCtl.visible = false;
    this.transformCtl.enabled = false;
    // Global gizmo visibility flag. setActive() honors this so toggling
    // the "축 표시" button suppresses the base gizmo even when switching
    // active robots.
    this._gizmosVisible = true;
    scene.add(this.transformCtl.getHelper ? this.transformCtl.getHelper() : this.transformCtl);
    this.transformCtl.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
    });
  }

  get active() { return this.robots.get(this.activeId); }
  getAll() { return [...this.robots.values()]; }

  add(type) {
    const cfg = this.configs[type];
    if (!cfg) return Promise.reject(new Error(`Unknown robot type: ${type}`));

    return new Promise((resolve, reject) => {
      this.loader.load(
        `robots/${type}/${type}.urdf`,
        (urdf) => {
          urdf.rotation.x = -Math.PI / 2;
          urdf.traverse((c) => { c.castShadow = true; c.receiveShadow = true; });
          addEdgesOverlay(urdf);

          const instance = new RobotInstance({ type, urdf, cfg });

          // Spawn offset: 1.2m along X, wrap to next row on Z every 3 robots.
          const n = this.robots.size;
          const col = n % 3;
          const row = Math.floor(n / 3);
          urdf.position.set(col * 1.2, 0, row * 1.5);

          this.scene.add(urdf);
          this.robots.set(instance.id, instance);
          this.onListChange();
          this.setActive(instance.id);
          resolve(instance);
        },
        undefined,
        (err) => reject(err),
      );
    });
  }

  remove(id) {
    const r = this.robots.get(id);
    if (!r) return;
    if (this.activeId === id) {
      const others = [...this.robots.keys()].filter((k) => k !== id);
      this.setActive(others[0] ?? null);
    }
    r.dispose(this.scene);
    this.robots.delete(id);
    this.onListChange();
  }

  setActive(id) {
    if (this.activeId === id) return;
    this.activeId = id;
    const active = this.active;

    // Apply edge highlight only to active robot's meshes.
    for (const r of this.robots.values()) {
      r.urdf.traverse((c) => {
        if (!c.userData.isEdgeOverlay) return;
        if (r === active) {
          if (c.userData._origColor === undefined) {
            c.userData._origColor = c.material.color.getHex();
            c.userData._origOpacity = c.material.opacity;
          }
          c.material.color.setHex(HIGHLIGHT_COLOR);
          c.material.opacity = 0.95;
        } else if (c.userData._origColor !== undefined) {
          c.material.color.setHex(c.userData._origColor);
          c.material.opacity = c.userData._origOpacity ?? 0.5;
          c.userData._origColor = undefined;
        }
      });
    }

    if (this.boxHelper) {
      this.scene.remove(this.boxHelper);
      this.boxHelper.geometry?.dispose();
      this.boxHelper.material?.dispose();
      this.boxHelper = null;
    }
    if (active) {
      this.boxHelper = new THREE.BoxHelper(active.urdf, HIGHLIGHT_COLOR);
      this.boxHelper.material.transparent = true;
      this.boxHelper.material.opacity = 0.6;
      this.scene.add(this.boxHelper);
      this.transformCtl.attach(active.urdf);
      this.transformCtl.visible = this._gizmosVisible;
      this.transformCtl.enabled = this._gizmosVisible;
    } else {
      this.transformCtl.detach();
      this.transformCtl.visible = false;
      this.transformCtl.enabled = false;
    }

    this.onActiveChange(active);
    this.onListChange();
  }

  // Called by app.js when entering IK mode: hide base-position gizmo so the
  // user can interact with the IK target gizmo without visual clutter.
  setPositionGizmoVisible(visible) {
    if (!this.active) return;
    this.transformCtl.visible = visible;
    this.transformCtl.enabled = visible;
  }

  // Global toggle from the "축 표시" button. Persists across setActive()
  // so switching robots doesn't bring the gizmo back.
  setGizmosVisible(visible) {
    this._gizmosVisible = visible;
    if (this.active) {
      this.transformCtl.visible = visible;
      this.transformCtl.enabled = visible;
    }
  }

  tick() {
    if (this.boxHelper) this.boxHelper.update();
    for (const r of this.robots.values()) {
      r.stepPoseAnim();
      r.stepGripperAnim();
    }
  }
}
