// Predefined joint poses for the 3-robot socket sorting line.
//
// All values are Indy7 6DOF — `joint0` is base yaw, `joint5` is wrist roll.
// Scenario constraints (table heights, conveyor row, etc.) baked in here;
// changing layout in loadFactoryScenario.js usually means re-tuning these.
//
// Pure data — no three.js, no DOM. Imported by the choreography modules
// and re-exported through the scenario-authoring public API for app.js.

const PI_2 = Math.PI / 2;

// "home" = the C-shape ready-to-pick pose (operator-tuned visual reference).
// All non-zero joints sit at clean ±π/2; TCP ends up next to the conveyor
// at conveyor-belt height, ready to grab a socket placed beside the robot.
export const HOME_POSE = {
  joint0: -PI_2,  // base yawed 90° toward conveyor side
  joint1:  0.00,  // shoulder vertical
  joint2: -PI_2,  // elbow folded back 90°
  joint3:  0.00,
  joint4: -PI_2,  // wrist tilted 90° (TCP points down)
  joint5:  0.00,
};

// Multi-stage work poses keep joint changes small so the arm stays in its
// footprint, with shoulder (joint1) driving vertical motion and base
// (joint0) driving lateral travel.
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
// micro-adjust at place). Used by defectRejectSequence() for replay
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
// Used by weighAndSortSequence() to replay the captured choreography
// instead of solving IK each cycle.
export const POSE_R3_REPLAY_OVER_A = pose({ joint0: -1.59 });
export const POSE_R3_REPLAY_AT_A   = { joint0: -1.59, joint1: -0.38, joint2: -1.53, joint3: 0.09, joint4: -1.34, joint5: 0.00 };
export const POSE_R3_REPLAY_OVER_B = pose({ joint0: -1.11 });
export const POSE_R3_REPLAY_AT_B   = { joint0: -1.11, joint1: -0.38, joint2: -1.40, joint3: 0.06, joint4: -1.58, joint5: 0.00 };
export const POSE_R3_REPLAY_OVER_C = pose({ joint0: -0.07 });
export const POSE_R3_REPLAY_AT_C   = { joint0: -0.07, joint1: -0.35, joint2: -1.49, joint3: 0.07, joint4: -1.60, joint5: 0.00 };
