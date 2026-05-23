// Module-level dispense queue + refs to the feeder hardware.
//
// The order panel pushes ORDER objects here via enqueueDispense(); each
// order = one tray + a list of socket specs to load onto it. The
// cylinder pops one order per stroke, spawns a tray on Conv1, then R1
// loads the sockets. Conv1 is paused for the loading window so the tray
// waits.
//
// `_feederState` is shared mutable state — loadFactoryScenario wires
// in the hardware refs at scene load, and choreography callbacks flip
// `r1Busy`. Exported as a named binding (not a getter) so consumers
// can mutate it; the encapsulation is by-convention, not enforced.
//
// Resetting `queue.length = 0` on scenario reload preserves identity
// (other modules holding the ref see it cleared).
export const _feederState = {
  queue: [],          // [{ orderId, sockets: [{type, defective?}, ...] }, ...]
  simRegistry: null,
  cylinder: null,
  sensor: null,
  conv1: null,
  robotManager: null,
  r1Busy: false,      // true while R1 is loading a tray; cylinder waits
};

// Push an order onto the supply line. Each order maps to ONE tray.
// `items` is a list of orders, each with { orderId, sockets }.
export function enqueueDispense(items) {
  if (!_feederState.cylinder) return; // scenario not loaded yet
  for (const it of items) _feederState.queue.push(it);
  if (_feederState.sensor && _feederState.queue.length > 0) {
    _feederState.sensor.setParam('detected', true);
  }
}

export function dispenseQueueLength() {
  return _feederState.queue.length;
}

// Soft-stop the feeder: drop any pending orders + flip the sensor off so
// the cylinder's tickHook drives `running` back to false. Used by the
// "전체 정지" / "자동 테스트 정지" buttons — without this, the tickHook
// would keep re-enabling the cylinder while the queue still had items
// even though the operator pressed stop.
export function clearDispenseQueue() {
  _feederState.queue.length = 0;
  if (_feederState.sensor) _feederState.sensor.setParam('detected', false);
}
