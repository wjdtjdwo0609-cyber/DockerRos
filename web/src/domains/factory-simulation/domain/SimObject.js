import * as THREE from 'three';

let nextSimObjectId = 0;

export class SimObject {
  constructor(typeLabel) {
    this.id = ++nextSimObjectId;
    this.type = typeLabel;
    this.root = new THREE.Group();
    this.root.name = `${typeLabel}_${this.id}`;
    this.root.userData.simObject = this;
    this.params = {};
    this.ui = [];
    this.opcua = { tag: null, direction: null, paramName: null };
    this._lastSentOpcua = undefined;
    this.registry = null;
  }

  setParam(name, value) {
    this.params[name] = value;
  }

  update(_dt) {}

  dispose() {
    this.root.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material.map) material.map.dispose();
          material.dispose();
        });
      }
    });
  }
}
