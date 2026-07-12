export type FlightPhase = "flying" | "landed" | "crashed";

export interface Controls {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  throttleUp: boolean;
  throttleDown: boolean;
  assistTiltX?: number;
  assistTiltZ?: number;
  assistThrottle?: number;
}

export interface FlightState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  tiltX: number;
  tiltZ: number;
  throttle: number;
  fuel: number;
  time: number;
  phase: FlightPhase;
  touchdownScore: number;
}

export const ROCKET_HALF_HEIGHT = 2.9;
export const DECK_CENTER_Z = 0;

export function createFlightState(): FlightState {
  return {
    position: { x: 7.5, y: 36, z: 13 },
    velocity: { x: -0.45, y: -2.2, z: -0.8 },
    tiltX: 0.025,
    tiltZ: -0.018,
    throttle: 0.55,
    fuel: 1,
    time: 0,
    phase: "flying",
    touchdownScore: 0,
  };
}

export function deckPose(time: number) {
  return {
    y: Math.sin(time * 0.72) * 0.32 + Math.sin(time * 1.31) * 0.08,
    roll: Math.sin(time * 0.53) * 0.018,
    pitch: Math.sin(time * 0.41 + 1.7) * 0.012,
  };
}

export function deckHeightAt(x: number, z: number, time: number) {
  const pose = deckPose(time);
  return pose.y + Math.tan(pose.roll) * x - Math.tan(pose.pitch) * (z - DECK_CENTER_Z);
}

export function stepFlight(state: FlightState, controls: Controls, dt: number) {
  if (state.phase !== "flying") return;
  state.time += dt;

  const throttleRate = 0.34;
  if (controls.assistThrottle !== undefined) state.throttle = approach(state.throttle, controls.assistThrottle, throttleRate * 1.8 * dt);
  else {
    if (controls.throttleUp) state.throttle += throttleRate * dt;
    if (controls.throttleDown) state.throttle -= throttleRate * dt;
  }
  state.throttle = Math.max(0, Math.min(1, state.throttle));

  const tiltRate = 0.42;
  const returnRate = 0.22;
  const tiltLimit = 0.28;
  const xTarget = controls.assistTiltX ?? ((controls.forward ? -tiltLimit : 0) + (controls.back ? tiltLimit : 0));
  const zTarget = controls.assistTiltZ ?? ((controls.left ? -tiltLimit : 0) + (controls.right ? tiltLimit : 0));
  state.tiltX = approach(state.tiltX, xTarget, (xTarget ? tiltRate : returnRate) * dt);
  state.tiltZ = approach(state.tiltZ, zTarget, (zTarget ? tiltRate : returnRate) * dt);

  const usableThrottle = state.fuel > 0 ? state.throttle : 0;
  const thrust = usableThrottle * 18.1;
  const ax = Math.sin(state.tiltZ) * thrust;
  const az = -Math.sin(state.tiltX) * thrust;
  const ay = Math.cos(state.tiltX) * Math.cos(state.tiltZ) * thrust - 9.81;

  state.velocity.x += ax * dt;
  state.velocity.y += ay * dt;
  state.velocity.z += az * dt;
  const airDrag = Math.pow(0.998, dt * 60);
  state.velocity.x *= airDrag;
  state.velocity.z *= airDrag;
  state.position.x += state.velocity.x * dt;
  state.position.y += state.velocity.y * dt;
  state.position.z += state.velocity.z * dt;
  state.fuel = Math.max(0, state.fuel - usableThrottle * 0.0072 * dt);

  const deckY = deckHeightAt(state.position.x, state.position.z, state.time);
  if (state.position.y - ROCKET_HALF_HEIGHT <= deckY) resolveContact(state, deckY);
}

function resolveContact(state: FlightState, deckY: number) {
  const onDeck = Math.abs(state.position.x) < 6.7 && Math.abs(state.position.z) < 15.5;
  const targetDistance = Math.hypot(state.position.x, state.position.z);
  const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  const tilt = Math.max(Math.abs(state.tiltX), Math.abs(state.tiltZ));
  const safe = onDeck && targetDistance < 4.5 && Math.abs(state.velocity.y) < 3.1 && horizontalSpeed < 2.1 && tilt < 0.14;

  state.position.y = deckY + ROCKET_HALF_HEIGHT;
  state.phase = safe ? "landed" : "crashed";
  state.touchdownScore = safe
    ? Math.max(0, Math.round(100 - targetDistance * 8 - Math.abs(state.velocity.y) * 7 - horizontalSpeed * 6 - tilt * 100))
    : 0;
  state.velocity = { x: 0, y: 0, z: 0 };
  if (safe) {
    state.tiltX = 0;
    state.tiltZ = 0;
    state.throttle = 0;
  }
}

function approach(value: number, target: number, amount: number) {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
}
