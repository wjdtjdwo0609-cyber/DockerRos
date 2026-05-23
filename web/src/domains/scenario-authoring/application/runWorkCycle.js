// Legacy stub: the line is now fully event-driven via setupRobotEventLoops.
// Retained so app.js's existing per-order call doesn't error; the only
// useful work it still does is reset gripper jaws so close animations
// have a clean starting state.
export function runWorkCycle({ robotManager }) {
  const robots = robotManager.getAll();
  if (robots.length < 3) return;
  const [r1, r2, r3] = robots;
  r1.openGripper(150);
  r2.openGripper(150);
  r3.openGripper(150);
}
