import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { portraitChaseFrame, lateralMotionAngle } from "../src/render/flightFraming.ts";
import { createFlightState, stepFlight } from "../src/simulation.ts";

test("portrait chase keeps the booster and target within the central playfield", () => {
  for (const aspect of [320 / 740, 390 / 844, 540 / 720]) {
    for (const position of [{ x: 7.5, y: 36, z: 13 }, { x: -14, y: 55, z: 19 }, { x: 0, y: 3, z: 0 }]) {
      const camera = new PerspectiveCamera(42, aspect, .1, 700);
      const frame = portraitChaseFrame(position, aspect, camera.fov);
      camera.position.copy(frame.desired);
      camera.lookAt(frame.target);
      camera.updateMatrixWorld();
      for (const point of [new Vector3(0, 0, 0), new Vector3(position.x, position.y + 4, position.z), new Vector3(position.x, position.y - 3, position.z)]) {
        point.project(camera);
        assert.ok(Math.abs(point.x) < .86, `horizontal clipping at aspect ${aspect}`);
        assert.ok(Math.abs(point.y) < .65, `HUD overlap at aspect ${aspect}`);
        assert.ok(point.z > -1 && point.z < 1);
      }
    }
  }
});

test("manual movement and lean retain their screen directions in portrait chase", () => {
  for (const [action, sign] of [["left", -1], ["right", 1], ["forward", 1], ["back", -1]] as const) {
    const state = createFlightState({ position: { x: 0, y: 36, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, wind: { x: 0, z: 0, gust: 0 } });
    for (let i = 0; i < 120; i++) stepFlight(state, { forward: action === "forward", back: action === "back", left: action === "left", right: action === "right", throttleUp: false, throttleDown: false }, 1 / 120);
    const camera = new PerspectiveCamera(42, 390 / 844, .1, 700);
    const frame = portraitChaseFrame(state.position, camera.aspect, camera.fov);
    camera.position.copy(frame.desired); camera.lookAt(frame.target); camera.updateMatrixWorld();
    const angle = lateralMotionAngle(state.velocity, camera);
    const lateral = action === "left" || action === "right";
    assert.equal(Math.sign(lateral ? Math.sin(angle * Math.PI / 180) : Math.cos(angle * Math.PI / 180)), sign);
    assert.equal(Math.sign(lateral ? -state.tiltZ : -state.tiltX), sign);
  }
});


test("octaweb drift cue follows visible ground motion even though the booster is behind the camera", () => {
  const camera = new PerspectiveCamera(42, 390 / 844, .1, 700);
  camera.position.set(0, 34.4, 0);
  camera.lookAt(0, 0, 0);
  for (const direction of [-1, 1]) {
    assert.equal(Math.sign(lateralMotionAngle({ x: direction, z: 0 }, camera)), direction);
  }
  camera.rotateZ(Math.PI);
  assert.equal(Math.sign(lateralMotionAngle({ x: 1, z: 0 }, camera)), -1);
});
