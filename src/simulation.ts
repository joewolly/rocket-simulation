export type FlightPhase = "flying" | "landed" | "crashed";

export interface Controls {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  throttleUp: boolean;
  throttleDown: boolean;
  pitchAxis?: number;
  rollAxis?: number;
  throttleAxis?: number;
  rateMode?: boolean;
  assistTiltX?: number;
  assistTiltZ?: number;
  assistThrottle?: number;
}

export interface FlightInit {
  missionId?: string;
  position?: Partial<FlightState["position"]>;
  velocity?: Partial<FlightState["velocity"]>;
  fuel?: number;
  throttle?: number;
  wind?: { x: number; z: number; gust: number };
  seaState?: number;
  gravity?: number;
  scoreMultiplier?: number;
}

export interface FlightState {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  angularVelocity: { x: number; z: number };
  gimbal: { x: number; z: number };
  wind: { x: number; z: number; gust: number; currentX: number; currentZ: number };
  tiltX: number;
  tiltZ: number;
  throttle: number;
  fuel: number;
  mass: number;
  stress: number;
  legCompression: number[];
  time: number;
  phase: FlightPhase;
  touchdownScore: number;
  touchdownVerticalSpeed: number;
  touchdownDrift: number;
  maxTilt: number;
  maxStress: number;
  missionId: string;
  seaState: number;
  gravity: number;
  scoreMultiplier: number;
}

export const ROCKET_HALF_HEIGHT = 2.9;
export const DECK_CENTER_Z = 0;
const DRY_MASS = 25_600;
const PROPELLANT_MASS = 9_400;

export function createFlightState(init: FlightInit = {}): FlightState {
  return {
    position: { x: init.position?.x ?? 7.5, y: init.position?.y ?? 36, z: init.position?.z ?? 13 },
    velocity: { x: init.velocity?.x ?? -0.45, y: init.velocity?.y ?? -2.2, z: init.velocity?.z ?? -0.8 },
    angularVelocity: { x: 0, z: 0 },
    gimbal: { x: 0, z: 0 },
    wind: {
      x: init.wind?.x ?? 1.2,
      z: init.wind?.z ?? -0.45,
      gust: init.wind?.gust ?? 0.55,
      currentX: init.wind?.x ?? 1.2,
      currentZ: init.wind?.z ?? -0.45,
    },
    tiltX: 0.025,
    tiltZ: -0.018,
    throttle: init.throttle ?? 0.55,
    fuel: init.fuel ?? 1,
    mass: DRY_MASS + PROPELLANT_MASS * (init.fuel ?? 1),
    stress: 0,
    legCompression: [0, 0, 0, 0],
    time: 0,
    phase: "flying",
    touchdownScore: 0,
    touchdownVerticalSpeed: 0,
    touchdownDrift: 0,
    maxTilt: 0,
    maxStress: 0,
    missionId: init.missionId ?? "qualification",
    seaState: init.seaState ?? 1,
    gravity: init.gravity ?? 9.81,
    scoreMultiplier: init.scoreMultiplier ?? 1,
  };
}

export function deckPose(time: number, seaState = 1) {
  const amplitude = Math.max(0.2, seaState);
  return {
    y: (Math.sin(time * 0.72) * 0.32 + Math.sin(time * 1.31) * 0.08) * amplitude,
    roll: Math.sin(time * 0.53) * 0.018 * amplitude,
    pitch: Math.sin(time * 0.41 + 1.7) * 0.012 * amplitude,
  };
}

export function deckHeightAt(x: number, z: number, time: number, seaState = 1) {
  const pose = deckPose(time, seaState);
  return pose.y + Math.tan(pose.roll) * x - Math.tan(pose.pitch) * (z - DECK_CENTER_Z);
}

export function stepFlight(state: FlightState, controls: Controls, dt: number) {
  if (state.phase !== "flying") return;
  state.time += dt;
  updateWind(state);

  const throttleRate = 0.34;
  if (controls.throttleAxis !== undefined) state.throttle = approach(state.throttle, clamp(controls.throttleAxis, 0, 1), throttleRate * 2.2 * dt);
  else if (controls.assistThrottle !== undefined) state.throttle = approach(state.throttle, controls.assistThrottle, throttleRate * 1.8 * dt);
  else {
    if (controls.throttleUp) state.throttle += throttleRate * dt;
    if (controls.throttleDown) state.throttle -= throttleRate * dt;
  }
  state.throttle = clamp(state.throttle, 0, 1);

  const tiltLimit = 0.3;
  const pitchAxis = controls.pitchAxis ?? ((controls.back ? 1 : 0) - (controls.forward ? 1 : 0));
  const rollAxis = controls.rollAxis ?? ((controls.left ? 1 : 0) - (controls.right ? 1 : 0));
  const desiredX = controls.assistTiltX ?? pitchAxis * tiltLimit;
  const desiredZ = controls.assistTiltZ ?? rollAxis * tiltLimit;

  // The flight computer is an attitude-rate controller. Input commands attitude;
  // engine gimbal produces torque, and angular velocity carries momentum.
  const directRateMode = controls.rateMode && controls.assistTiltX === undefined;
  const gimbalXTarget = directRateMode
    ? clamp(pitchAxis * .12 - state.angularVelocity.x * .2, -.12, .12)
    : clamp((desiredX - state.tiltX) * 2.8 - state.angularVelocity.x * 1.35, -0.12, 0.12);
  const gimbalZTarget = directRateMode
    ? clamp(rollAxis * .12 - state.angularVelocity.z * .2, -.12, .12)
    : clamp((desiredZ - state.tiltZ) * 2.8 - state.angularVelocity.z * 1.35, -0.12, 0.12);
  state.gimbal.x = approach(state.gimbal.x, gimbalXTarget, dt * 0.7);
  state.gimbal.z = approach(state.gimbal.z, gimbalZTarget, dt * 0.7);

  const usableThrottle = state.fuel > 0 ? state.throttle : 0;
  state.mass = DRY_MASS + PROPELLANT_MASS * state.fuel;
  const massScale = (DRY_MASS + PROPELLANT_MASS) / state.mass;
  const thrust = usableThrottle * 18.1 * massScale;
  const torqueAuthority = usableThrottle * 5.8 * massScale;
  const windTorqueX = (state.wind.currentZ - state.velocity.z) * 0.0018;
  const windTorqueZ = -(state.wind.currentX - state.velocity.x) * 0.0018;
  state.angularVelocity.x += (state.gimbal.x * torqueAuthority + windTorqueX - state.angularVelocity.x * 0.42) * dt;
  state.angularVelocity.z += (state.gimbal.z * torqueAuthority + windTorqueZ - state.angularVelocity.z * 0.42) * dt;
  state.tiltX = clamp(state.tiltX + state.angularVelocity.x * dt, -0.52, 0.52);
  state.tiltZ = clamp(state.tiltZ + state.angularVelocity.z * dt, -0.52, 0.52);

  const ax = -Math.sin(state.tiltZ) * thrust;
  const az = Math.sin(state.tiltX) * thrust;
  const ay = Math.cos(state.tiltX) * Math.cos(state.tiltZ) * thrust - state.gravity;
  const altitude = Math.max(0, state.position.y - deckHeightAt(state.position.x, state.position.z, state.time, state.seaState));
  const airDensity = clamp(altitude / 80, 0.08, 1);
  const drag = 0.018 * airDensity;
  state.velocity.x += (ax + (state.wind.currentX - state.velocity.x) * drag) * dt;
  state.velocity.y += ay * dt;
  state.velocity.z += (az + (state.wind.currentZ - state.velocity.z) * drag) * dt;
  state.position.x += state.velocity.x * dt;
  state.position.y += state.velocity.y * dt;
  state.position.z += state.velocity.z * dt;
  state.fuel = Math.max(0, state.fuel - usableThrottle * 0.0072 * dt);

  const accelerationLoad = Math.hypot(ax, ay + state.gravity, az) / state.gravity;
  state.stress = Math.max(0, accelerationLoad - 0.75) + Math.hypot(state.angularVelocity.x, state.angularVelocity.z) * 1.6;
  state.maxStress = Math.max(state.maxStress, state.stress);
  state.maxTilt = Math.max(state.maxTilt, Math.abs(state.tiltX), Math.abs(state.tiltZ));
  updateLegContacts(state);
}

function updateWind(state: FlightState) {
  const gustA = Math.sin(state.time * 0.77 + 1.1) + Math.sin(state.time * 1.93) * 0.38;
  const gustB = Math.sin(state.time * 0.58 + 3.4) + Math.sin(state.time * 2.17) * 0.31;
  state.wind.currentX = state.wind.x + gustA * state.wind.gust;
  state.wind.currentZ = state.wind.z + gustB * state.wind.gust;
}

function updateLegContacts(state: FlightState) {
  const footRadius = 1.15;
  let deepest = 0;
  let contacts = 0;
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + Math.PI / 4;
    const localX = Math.sin(angle) * footRadius;
    const localZ = Math.cos(angle) * footRadius;
    const footX = state.position.x + localX;
    const footZ = state.position.z + localZ;
    const tiltOffset = -localX * state.tiltZ + localZ * state.tiltX;
    const footY = state.position.y - ROCKET_HALF_HEIGHT + tiltOffset;
    const deckY = deckHeightAt(footX, footZ, state.time, state.seaState);
    const compression = clamp((deckY - footY) / 0.24, 0, 1);
    state.legCompression[i] = compression;
    if (compression > 0) contacts++;
    deepest = Math.max(deepest, deckY - footY);
  }
  if (contacts === 0) return;

  const deckY = deckHeightAt(state.position.x, state.position.z, state.time, state.seaState);
  state.position.y += Math.max(0, deepest);
  resolveContact(state, deckY, contacts);
}

function resolveContact(state: FlightState, deckY: number, contacts: number) {
  const onDeck = Math.abs(state.position.x) < 6.7 && Math.abs(state.position.z) < 15.5;
  const targetDistance = Math.hypot(state.position.x, state.position.z);
  const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  const verticalSpeed = Math.abs(state.velocity.y);
  const tilt = Math.max(Math.abs(state.tiltX), Math.abs(state.tiltZ));
  const angularSpeed = Math.hypot(state.angularVelocity.x, state.angularVelocity.z);
  const safe = onDeck && targetDistance < 4.5 && verticalSpeed < 3.1 && horizontalSpeed < 2.1 && tilt < 0.14 && angularSpeed < 0.17 && contacts >= 1;

  state.touchdownVerticalSpeed = verticalSpeed;
  state.touchdownDrift = horizontalSpeed;
  state.position.y = Math.max(state.position.y, deckY + ROCKET_HALF_HEIGHT);
  state.phase = safe ? "landed" : "crashed";
  state.touchdownScore = safe
    ? Math.max(0, Math.round((100 - targetDistance * 8 - verticalSpeed * 7 - horizontalSpeed * 6 - tilt * 100 - angularSpeed * 35) * state.scoreMultiplier))
    : 0;
  state.velocity = { x: 0, y: 0, z: 0 };
  if (safe) {
    state.angularVelocity = { x: 0, z: 0 };
    state.gimbal = { x: 0, z: 0 };
    state.tiltX = 0;
    state.tiltZ = 0;
    state.throttle = 0;
    state.legCompression.fill(0.45);
  }
}

function approach(value: number, target: number, amount: number) {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
