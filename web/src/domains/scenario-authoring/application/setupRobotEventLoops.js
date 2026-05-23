// Event-driven per-robot loops for the 3-robot socket sorting line.
//
// Each robot wakes on its own sensor signal:
//   R1 — driven by OrderReady sensor + feeder cylinder (wired in
//        loadFactoryScenario via the cylinder's _onExtended hook).
//   R2 — defect VisionCamera flags `good=false & detectedDefective=true`.
//   R3 — a tray hits `_stoppedAtScale` (parking tickHook).
//
// Idempotent: every entry path checks a busy flag + per-item marker so
// the same trigger doesn't kick off the sequence twice. Runs continuously,
// so the auto-demo just enqueues orders and the rest of the line follows.

import * as THREE from 'three';
import { defectRejectSequence, weighAndSortSequence } from './robotChoreography.js';

export function setupRobotEventLoops({ simRegistry, robotManager }) {
  const robots = robotManager.getAll();
  if (robots.length < 3) return;
  const [, r2, r3] = robots;

  let r2Busy = false;
  let r3Busy = false;
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  // R2: vision-triggered defect rejection.
  simRegistry.tickHooks.push(() => {
    if (r2Busy) return;
    const defectCam = [...simRegistry.objects.values()]
      .find((o) => o.type === 'VisionCamera' && o.opcua?.tag === 'VisionDetect');
    if (!defectCam) return;
    if (!defectCam.params.detecting || defectCam.params.good) return;
    if (!defectCam.params.detectedDefective) return;

    defectCam.root.getWorldPosition(tmpB);
    const target = simRegistry.getObjectsByTypes(['8핀소켓', '12핀소켓'])
      .filter((s) => !s._pickedBy && !s._r2Handled && s.params.defective)
      .find((s) => {
        s.root.getWorldPosition(tmpA);
        const dCam = tmpA.distanceTo(tmpB);
        r2.urdf.getWorldPosition(tmpB);
        const dRobot = tmpA.distanceTo(tmpB);
        defectCam.root.getWorldPosition(tmpB);  // restore for next iteration
        return dCam < 0.45 && dRobot < 0.90;
      });
    if (!target) return;

    target._r2Handled = true;
    r2Busy = true;
    const conv2 = [...simRegistry.objects.values()]
      .find((o) => o.type === 'Conveyor' && o.opcua?.tag === 'Conv2');
    const wasRunning = conv2?.params.running ?? false;
    if (conv2) conv2.params.running = false;
    defectRejectSequence({
      robot: r2, simRegistry, socketToPick: target, t0: 0,
      onComplete: () => {
        r2Busy = false;
        if (conv2 && wasRunning) conv2.params.running = true;
      },
    });
  });

  // R3: tray-stopped weigh+sort.
  simRegistry.tickHooks.push(() => {
    if (r3Busy) return;
    const trays = simRegistry.getObjectsByType('Tray');
    const stopped = trays.find((t) => t._stoppedAtScale && !t._r3Started);
    if (!stopped) return;
    stopped.root.getWorldPosition(tmpA);
    const candidate = simRegistry.getObjectsByTypes(['8핀소켓', '12핀소켓'])
      .filter((s) => !s._pickedBy)
      .find((s) => {
        s.root.getWorldPosition(tmpB);
        return tmpA.distanceTo(tmpB) < 0.30 && tmpB.y > 0.20;
      });
    if (!candidate) return;

    stopped._r3Started = true;
    r3Busy = true;
    weighAndSortSequence({
      robot: r3, simRegistry, socketToPick: candidate, t0: 0,
      onComplete: () => {
        r3Busy = false;
        const sidePusher = [...simRegistry.objects.values()]
          .find((o) => o.type === 'Cylinder' && o.opcua?.tag === 'ScalePusher');
        if (sidePusher) sidePusher.params.running = true;
        setTimeout(() => {
          const conv3 = [...simRegistry.objects.values()]
            .find((o) => o.type === 'Conveyor' && o.opcua?.tag === 'Conv3');
          if (conv3) conv3.params.running = true;
        }, 1500);
      },
    });
  });
}
