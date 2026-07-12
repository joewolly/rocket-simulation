import * as THREE from "three";
import "./style.css";
import { createFlightState, deckHeightAt, deckPose, ROCKET_HALF_HEIGHT, stepFlight, type Controls } from "./simulation";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x819093);
scene.fog = new THREE.FogExp2(0x839194, 0.012);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);

const hemi = new THREE.HemisphereLight(0xe6f3f0, 0x15252c, 2.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d9, 3.2);
sun.position.set(-28, 46, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45;
sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45;
sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 130;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);
const ocean = createOcean();
const ship = createShip();
const rocket = createRocket();
const landingMarker = createLandingMarker();
world.add(ocean, ship, rocket, landingMarker);

let state = createFlightState();
const controls: Controls = { forward: false, back: false, left: false, right: false, throttleUp: false, throttleDown: false };
let paused = false;
let cameraMode = 0;
let accumulator = 0;
let previousTime = performance.now();
let endShown = false;
const fixedDt = 1 / 120;

const ui = {
  altitude: text("altitude"), velocity: text("velocity"), fuel: text("fuel"), drift: text("drift"),
  status: text("statusText"), throttleValue: text("throttleValue"), callout: text("callout"),
  throttle: document.querySelector<HTMLInputElement>("#throttle")!, modal: document.querySelector<HTMLElement>("#modal")!,
  modalEyebrow: text("modalEyebrow"), modalTitle: text("modalTitle"), modalCopy: text("modalCopy"),
  modalAction: document.querySelector<HTMLButtonElement>("#modalAction")!, pauseButton: document.querySelector<HTMLButtonElement>("#pauseButton")!,
};

bindInputs();
resize();
window.addEventListener("resize", resize);
canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); setPaused(true); showModal("RENDERER PAUSED", "Graphics context was interrupted. The simulator will recover when it returns.", "WAITING", "SYSTEM"); });
canvas.addEventListener("webglcontextrestored", () => { hideModal(); setPaused(false); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state.phase === "flying") setPaused(true); });
renderer.setAnimationLoop(frame);

function frame(now: number) {
  const elapsed = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  if (!paused) {
    accumulator += elapsed;
    while (accumulator >= fixedDt) {
      stepFlight(state, controls, fixedDt);
      accumulator -= fixedDt;
    }
  }
  updateWorld(now / 1000, elapsed);
  updateUi();
  renderer.render(scene, camera);
}

function updateWorld(visualTime: number, dt: number) {
  const pose = deckPose(state.time);
  ship.position.y = pose.y;
  ship.rotation.set(pose.pitch, 0, pose.roll);
  landingMarker.position.y = pose.y + 0.23;
  landingMarker.rotation.set(-Math.PI / 2 + pose.pitch, 0, pose.roll);

  rocket.position.set(state.position.x, state.position.y, state.position.z);
  rocket.rotation.order = "XYZ";
  rocket.rotation.set(state.tiltX, 0, state.tiltZ);
  const flame = rocket.userData.flame as THREE.Group;
  const flameScale = state.phase === "flying" && state.fuel > 0 ? state.throttle * (0.85 + Math.sin(visualTime * 48) * 0.1) : 0;
  flame.scale.set(1, flameScale, 1);
  flame.visible = flameScale > 0.02;

  const water = ocean.material as THREE.ShaderMaterial;
  water.uniforms.uTime.value = visualTime;

  const desired = new THREE.Vector3();
  const target = new THREE.Vector3();
  if (cameraMode === 0) {
    desired.set(state.position.x + 25, state.position.y + 14, state.position.z + 32);
    target.set(state.position.x * 0.35, Math.max(3, state.position.y - 7), state.position.z * 0.25);
  } else {
    desired.set(-24, 12, 30);
    target.set(state.position.x, Math.max(3, state.position.y), state.position.z);
  }
  const ease = 1 - Math.exp(-dt * 2.8);
  camera.position.lerp(desired, ease);
  camera.lookAt(target);

  if (state.phase !== "flying" && !endShown) {
    endShown = true;
    window.setTimeout(showEndState, 500);
  }
}

function createOcean() {
  const geometry = new THREE.PlaneGeometry(500, 500, 80, 80);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x071b22) }, uTop: { value: new THREE.Color(0x1d525b) } },
    vertexShader: `uniform float uTime; varying float vWave; varying vec3 vNormalW;
      void main(){ vec3 p=position; float a=sin(p.x*.12+uTime*.85)*.24; float b=sin(p.y*.085-uTime*.68)*.18; float c=sin((p.x+p.y)*.045+uTime*.42)*.30; p.z=a+b+c; vWave=p.z; vec4 w=modelMatrix*vec4(p,1.); vNormalW=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uDeep; uniform vec3 uTop; varying float vWave; varying vec3 vNormalW;
      void main(){ float fres=pow(1.-max(dot(normalize(vNormalW),vec3(0.,1.,0.)),0.),2.); vec3 col=mix(uDeep,uTop,clamp(vWave+0.42,0.,1.)); col+=fres*.22; gl_FragColor=vec4(col,1.); }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -2.2;
  mesh.receiveShadow = true;
  return mesh;
}

function createShip() {
  const group = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x11191b, roughness: 0.8, metalness: 0.45 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2b3030, roughness: 0.94, metalness: 0.18 });
  const white = new THREE.MeshStandardMaterial({ color: 0xadb4ad, roughness: 0.7 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(15, 3.5, 35), hullMat);
  hull.position.y = -1.5; hull.castShadow = hull.receiveShadow = true; group.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(7.5, 7, 4), hullMat);
  bow.rotation.set(Math.PI / 2, Math.PI / 4, 0); bow.position.set(0, -1.5, -20); bow.scale.x = 0.72; bow.castShadow = true; group.add(bow);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(14.5, .42, 32), deckMat);
  deck.position.y = .02; deck.castShadow = deck.receiveShadow = true; group.add(deck);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3.4, 5.4, 5), white);
  tower.position.set(4.6, 2.85, 10.4); tower.castShadow = true; group.add(tower);
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x7dabc0, emissive: 0x142d35, emissiveIntensity: 2 });
  const windows = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.15, 2.7), windowMat);
  windows.position.set(4.6, 4.1, 8.9); group.add(windows);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.09, .15, 6, 8), white);
  mast.position.set(4.6, 8, 11); group.add(mast);
  const crane = new THREE.Mesh(new THREE.BoxGeometry(.22, .22, 9), white);
  crane.position.set(-5.2, 3.2, 8); crane.rotation.x = -.18; group.add(crane);
  const cranePost = new THREE.Mesh(new THREE.CylinderGeometry(.14, .2, 5, 8), white);
  cranePost.position.set(-5.2, 2.5, 12); group.add(cranePost);
  for (const x of [-6.7, 6.7]) for (let z = -13; z < 14; z += 3.2) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(.08, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff7a32 }));
    light.position.set(x, .35, z); group.add(light);
  }
  return group;
}

function createLandingMarker() {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xe8eee8, transparent: true, opacity: .78, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.38, 64), ringMat); group.add(ring);
  const inner = new THREE.Mesh(new THREE.RingGeometry(.9, 1.03, 48), ringMat); group.add(inner);
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(.16, 1.2), ringMat);
    const a = i * Math.PI / 2; stripe.position.set(Math.sin(a) * 2.2, Math.cos(a) * 2.2, 0); stripe.rotation.z = -a; group.add(stripe);
  }
  return group;
}

function createRocket() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9ddd7, roughness: .48, metalness: .64 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x171c1c, roughness: .62, metalness: .4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.75, .88, 4.3, 24), bodyMat); body.position.y = .25; body.castShadow = true; group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.75, 1.4, 24), bodyMat); nose.position.y = 3.1; nose.castShadow = true; group.add(nose);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.77, .77, .48, 24), darkMat); band.position.y = 1.45; group.add(band);
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(.43, .62, .65, 16), darkMat); engine.position.y = -2.18; group.add(engine);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.11, 2.25, .14), darkMat);
    leg.position.set(Math.sin(a) * .78, -1.75, Math.cos(a) * .78); leg.rotation.z = Math.sin(a) * -.32; leg.rotation.x = Math.cos(a) * .32; group.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.48, .09, .48), darkMat); foot.position.set(Math.sin(a) * 1.15, -2.82, Math.cos(a) * 1.15); group.add(foot);
  }
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(.5, 3.5, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: .62, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  outer.rotation.x = Math.PI; outer.position.y = -4.1; flame.add(outer);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(.25, 2.2, 14), new THREE.MeshBasicMaterial({ color: 0xfff0b1, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  inner.rotation.x = Math.PI; inner.position.y = -3.6; flame.add(inner);
  group.add(flame); group.userData.flame = flame;
  return group;
}

function updateUi() {
  const deckY = deckHeightAt(state.position.x, state.position.z, state.time);
  const altitude = Math.max(0, state.position.y - ROCKET_HALF_HEIGHT - deckY);
  const drift = Math.hypot(state.velocity.x, state.velocity.z);
  ui.altitude.textContent = altitude.toFixed(1).padStart(4, "0");
  ui.velocity.textContent = Math.abs(state.velocity.y).toFixed(1);
  ui.velocity.style.color = Math.abs(state.velocity.y) > 3.1 && altitude < 10 ? "#ff5a1f" : "";
  ui.fuel.textContent = Math.round(state.fuel * 100).toString();
  ui.drift.textContent = drift.toFixed(1);
  const percent = Math.round(state.throttle * 100);
  ui.throttle.value = percent.toString(); ui.throttleValue.textContent = `${percent}%`;
  ui.throttle.style.setProperty("--fill", `${percent}%`);
  const targetDistance = Math.hypot(state.position.x, state.position.z);
  ui.callout.innerHTML = targetDistance < 5 ? "DECK LOCKED <b>●</b>" : "ALIGN WITH TARGET <b>◆</b>";
  if (state.phase === "flying") ui.status.textContent = altitude < 8 ? "Touchdown checks active" : targetDistance < 6 ? "Landing solution nominal" : "Correct lateral drift";
}

function bindInputs() {
  const keyMap: Record<string, keyof Controls> = { ArrowUp: "forward", ArrowDown: "back", ArrowLeft: "left", ArrowRight: "right", KeyW: "throttleUp", KeyS: "throttleDown", Space: "throttleUp", ShiftLeft: "throttleDown" };
  window.addEventListener("keydown", (event) => {
    const control = keyMap[event.code]; if (control) { controls[control] = true; event.preventDefault(); }
    if (!event.repeat && event.code === "KeyC") changeCamera();
    if (!event.repeat && (event.code === "KeyP" || event.code === "Escape")) togglePause();
    if (!event.repeat && event.code === "KeyR") resetFlight();
  });
  window.addEventListener("keyup", (event) => { const control = keyMap[event.code]; if (control) controls[control] = false; });
  ui.throttle.addEventListener("input", () => { state.throttle = Number(ui.throttle.value) / 100; });
  document.querySelector("#cameraButton")!.addEventListener("click", changeCamera);
  document.querySelector("#pauseButton")!.addEventListener("click", () => togglePause());
  document.querySelector("#restartButton")!.addEventListener("click", resetFlight);
  ui.modalAction.addEventListener("click", () => state.phase === "flying" ? togglePause(false) : resetFlight());
  document.querySelectorAll<HTMLButtonElement>("[data-control]").forEach((button) => {
    const name = button.dataset.control as keyof Controls;
    const set = (value: boolean) => { controls[name] = value; };
    button.addEventListener("pointerdown", (event) => { button.setPointerCapture(event.pointerId); set(true); });
    button.addEventListener("pointerup", () => set(false)); button.addEventListener("pointercancel", () => set(false));
  });
  window.setTimeout(() => document.querySelector("#hint")?.classList.add("hidden-hint"), 7000);
}

function changeCamera() { cameraMode = (cameraMode + 1) % 2; }
function togglePause(force?: boolean) { if (state.phase !== "flying") return; setPaused(force ?? !paused); if (paused) showModal("FLIGHT PAUSED", "Simulation time is frozen. Your landing solution is preserved.", "RESUME FLIGHT", "MISSION 04"); else hideModal(); }
function setPaused(value: boolean) { paused = value; ui.pauseButton.firstChild!.textContent = value ? "RESUME " : "PAUSE "; }
function resetFlight() { state = createFlightState(); paused = false; endShown = false; accumulator = 0; hideModal(); }
function showEndState() {
  if (state.phase === "landed") showModal("TOUCHDOWN", `Odyssey secured. Landing quality ${state.touchdownScore}/100. Engines safe.`, "FLY AGAIN", "MISSION COMPLETE");
  else showModal("VEHICLE LOST", "Touchdown limits exceeded. Reduce vertical speed, drift, and tilt before deck contact.", "RETRY APPROACH", "MISSION FAILED");
}
function showModal(title: string, copy: string, action: string, eyebrow: string) { ui.modalTitle.textContent = title; ui.modalCopy.textContent = copy; ui.modalAction.textContent = action; ui.modalEyebrow.textContent = eyebrow; ui.modal.classList.remove("hidden"); }
function hideModal() { ui.modal.classList.add("hidden"); }
function resize() { const w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); }
function text(id: string) { return document.querySelector<HTMLElement>(`#${id}`)!; }
