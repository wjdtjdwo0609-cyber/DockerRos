// Public API for the scenario-authoring bounded context.
//
// Composition root (app.js) imports from here through web/src/public-api.
// Internal modules should import each other directly, NOT via this barrel.
export {
  HOME_POSE,
  POSE_R1_OVER_PICK, POSE_R1_AT_PICK, POSE_R1_OVER_PLACE, POSE_R1_AT_PLACE,
  POSE_R2_INSPECT,
  POSE_R2_REPLAY_OVER_PICK, POSE_R2_REPLAY_AT_PICK,
  POSE_R2_REPLAY_LIFT,
  POSE_R2_REPLAY_OVER_PLACE, POSE_R2_REPLAY_AT_PLACE,
  POSE_R3_OVER_PICK, POSE_R3_AT_PICK, POSE_R3_OVER_PLACE, POSE_R3_AT_PLACE,
  POSE_R3_REPLAY_OVER_A, POSE_R3_REPLAY_AT_A,
  POSE_R3_REPLAY_OVER_B, POSE_R3_REPLAY_AT_B,
  POSE_R3_REPLAY_OVER_C, POSE_R3_REPLAY_AT_C,
} from './domain/poses.js';
export {
  enqueueDispense,
  dispenseQueueLength,
  clearDispenseQueue,
} from './domain/dispenseQueue.js';
export { loadFactoryScenario } from './application/loadFactoryScenario.js';
export { runWeldingTest } from './application/runWeldingTest.js';
export { runWorkCycle } from './application/runWorkCycle.js';
