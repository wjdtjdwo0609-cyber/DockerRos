// Compatibility barrel for robot-control.
// The implementation is split into domain, application, and infrastructure modules.

export { buildPen, buildGripper } from './infrastructure/three/toolMeshes.js';
export { RobotInstance } from './application/RobotInstance.js';
export { RobotManager } from './application/RobotManager.js';
