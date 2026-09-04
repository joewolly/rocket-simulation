import { PerspectiveCamera, Vector3 } from "three";

/** Fit booster and target inside the central portrait playfield, keeping chase azimuth. */
export function portraitChaseFrame(position: { x: number; y: number; z: number }, aspect: number, fov: number) {
  const target = new Vector3(position.x * .5, Math.max(3, position.y * .5), position.z * .5);
  const halfFov = fov * Math.PI / 360;
  const back = new Vector3(23, 12, 29).normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), back).normalize();
  const up = new Vector3().crossVectors(back, right);
  const points = [
    new Vector3(position.x, position.y + 4, position.z),
    new Vector3(position.x, position.y - 3, position.z),
    ...[-7, 7].flatMap(x => [-16, 16].map(z => new Vector3(x, 0, z))),
  ];
  let distance = 30;
  for (const point of points) {
    const offset = point.sub(target);
    const depth = offset.dot(back);
    distance = Math.max(distance,
      depth + Math.abs(offset.dot(right)) / (Math.tan(halfFov) * aspect * .84),
      depth + Math.abs(offset.dot(up)) / (Math.tan(halfFov) * .52));
  }
  const desired = back.multiplyScalar(distance).add(target);
  return { target, desired };
}

const motion = new Vector3();
/** Screen angle of horizontal motion; zero points up, including onboard cameras. */
export function lateralMotionAngle(velocity: { x: number; z: number }, camera: PerspectiveCamera) {
  camera.updateMatrixWorld();
  motion.set(velocity.x, 0, velocity.z).transformDirection(camera.matrixWorldInverse);
  return Math.atan2(motion.x, motion.y) * 180 / Math.PI;
}
