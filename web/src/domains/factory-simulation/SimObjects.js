// Compatibility barrel for factory simulation objects.
// Concrete equipment implementations live under objects/.

export { addEdgesOverlay } from '../../infrastructure/three/addEdgesOverlay.js';
export { SimObject } from './domain/SimObject.js';
export { ConveyorBelt, Cylinder, Sensor, VerticalConveyor } from './objects/conveyors.js';
export { Socket8, Socket12, applySocketConveyorCoupling } from './objects/sockets.js';
export { TrayStack, Tray } from './objects/trays.js';
export { Table, StorageBox } from './objects/storage.js';
export { VisionCamera } from './objects/inspection.js';
export { WeightScale } from './objects/weighing.js';
