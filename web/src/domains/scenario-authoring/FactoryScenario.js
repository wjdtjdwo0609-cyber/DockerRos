// Backwards-compatibility shim. The original 1052-line god module was
// split into focused files under domain/ and application/ — re-exported
// here so any direct import of FactoryScenario.js (legacy code, external
// tools) keeps working. New code should import from
// './index.js' (or from web/src/public-api/index.js).
//
// Internal references inside scenario-authoring should target the new
// files directly, not this shim.
export * from './domain/poses.js';
export * from './domain/dispenseQueue.js';
export { loadFactoryScenario } from './application/loadFactoryScenario.js';
export { runWeldingTest } from './application/runWeldingTest.js';
export { runWorkCycle } from './application/runWorkCycle.js';
export {
  loadTraySequence,
  pickPlaceSequence,
  defectRejectSequence,
  weighAndSortSequence,
} from './application/robotChoreography.js';
export { setupRobotEventLoops } from './application/setupRobotEventLoops.js';
