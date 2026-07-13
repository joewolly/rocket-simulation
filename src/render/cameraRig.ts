export type CameraMode = 0 | 1 | 2;
export type TrackingCameraMode = Exclude<CameraMode, 2>;

interface Position {
  x: number;
  y: number;
  z: number;
}

export interface TrackingCameraPose {
  position: Position;
  target: Position;
}

export function trackingCameraPose(mode: TrackingCameraMode, rocket: Position, aspect=16/9): TrackingCameraPose {
  if (mode === 0) {
    const portrait=aspect<.8;
    return {
      position: { x: rocket.x + (portrait?16:25), y: rocket.y + (portrait?11:14), z: rocket.z + (portrait?39:32) },
      target: { x: rocket.x * (portrait?.22:.35), y: Math.max(3, rocket.y - (portrait?13:7)), z: rocket.z * (portrait?.18:.25) },
    };
  }

  return {
    position: { x: aspect<.8?-15:-24, y: aspect<.8?10:12, z: aspect<.8?38:30 },
    target: { x: rocket.x, y: Math.max(3, rocket.y), z: rocket.z },
  };
}
