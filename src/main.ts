import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import "./style.css";
import { createFlightState, deckHeightAt, deckPose, ROCKET_HALF_HEIGHT, stepFlight, TOUCHDOWN_LIMITS, type Controls } from "./simulation";
import { MISSIONS, type MissionDefinition } from "./game/missions";
import { FlightAudio } from "./game/audio";
import { updateLandingAssist } from "./game/autopilot";
import { pollGamepad, pulseGamepad } from "./game/input";
import { loadRecords, recordLanding, saveRecords } from "./game/persistence";
import { applyReplayState, ReplayRecorder } from "./game/replay";
import { getLandingReadiness, getLandingDebrief } from "./game/landingFeedback";
import { renderLandingDebrief } from "./ui/landingDebrief";
import { createOverlayManager } from "./ui/overlay";
import { lateralMotionAngle, portraitChaseFrame } from "./render/flightFraming";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x819093);
scene.fog = new THREE.FogExp2(0x839194, 0.011);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 700);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.055;
orbit.enablePan = false;
orbit.minDistance = 8;
orbit.maxDistance = 95;
orbit.maxPolarAngle = Math.PI * 0.485;
orbit.enabled = false;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.4, 0.82);
composer.addPass(bloom);

// PMREM Environment Generator for realistic PBR metalness & roughness reflections
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

const hemi = new THREE.HemisphereLight(0xe8f5f2, 0x112128, 2.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dc, 3.4);
sun.position.set(-28, 48, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45;
sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45;
sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 130;
sun.shadow.bias = -0.0003;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);
const sky = createSky();
const ocean = createOcean();
const shipData = createShip();
const ship = shipData.group;
const rocket = createRocket();
const landingMarker = createLandingMarker();
const clouds = createClouds();
const exhaust = createExhaustTrail();
const rcsPuffs = createRcsPuffs();
const groundWash = createGroundWash();
const impactEffect = createImpactEffect();
const trajectoryLine = createTrajectoryLine();
world.add(
  sky,
  ocean,
  ship,
  rocket,
  landingMarker,
  clouds,
  exhaust.points,
  rcsPuffs.points,
  groundWash.points,
  impactEffect.group,
  trajectoryLine
);

let currentMission = MISSIONS[0];
let state = createFlightState(currentMission.init);
const controls: Controls = { forward: false, back: false, left: false, right: false, throttleUp: false, throttleDown: false };
const recorder = new ReplayRecorder();
const flightAudio = new FlightAudio();
const records = loadRecords();
flightAudio.setEnabled(records.audioEnabled);
let paused = false;
let cameraMode = 0;
const CAMERA_NAMES = ["CHASE", "DECK", "ORBIT", "OCTAWEB", "BARGE"];
let accumulator = 0;
let previousTime = performance.now();
let endShown = false;
let assistEnabled = false;
let replaying = false;
let replayTime = 0;
let drawerOpen = false;
let rateMode = false;
let flightMenuOpen = false;
let pausedBeforePanel = false;
let endTimer: number | undefined;
const overlay = createOverlayManager();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const fixedDt = 1 / 120;
const simulationRate = import.meta.env.DEV ? Math.max(1, Math.min(6, Number(new URLSearchParams(location.search).get("simSpeed")) || 1)) : 1;

let engineThermalHeat = 0;

const ui = {
  altitude: text("altitude"),
  verticalDirection: text("verticalDirection"),
  driftArrow: text("driftArrow"),
  touchThrottle: text("touchThrottle"),
  flightMenuButton: text("flightMenuButton"),
  flightActions: text("flightActions"),
  closeFlightMenu: text("closeFlightMenu"),
  velocity: text("velocity"),
  fuel: text("fuel"),
  drift: text("drift"),
  status: text("statusText"),
  throttleValue: text("throttleValue"),
  callout: text("callout"),
  throttle: document.querySelector<HTMLInputElement>("#throttle")!,
  modal: document.querySelector<HTMLElement>("#modal")!,
  modalEyebrow: text("modalEyebrow"),
  modalTitle: text("modalTitle"),
  modalCopy: text("modalCopy"),
  modalAction: document.querySelector<HTMLButtonElement>("#modalAction")!,
  pauseButton: document.querySelector<HTMLButtonElement>("#pauseButton")!,
  modalReplay: document.querySelector<HTMLButtonElement>("#modalReplay")!,
  autoButton: document.querySelector<HTMLButtonElement>("#autoButton")!,
  cameraButton: document.querySelector<HTMLButtonElement>("#cameraButton")!,
  missionButton: document.querySelector<HTMLButtonElement>("#missionButton")!,
  replayButton: document.querySelector<HTMLButtonElement>("#replayButton")!,
  audioButton: document.querySelector<HTMLButtonElement>("#audioButton")!,
  missionDrawer: document.querySelector<HTMLElement>("#missionDrawer")!,
  missionList: text("missionList"),
  missionNumber: text("missionNumber"),
  missionTitle: text("missionTitle"),
  closeMissionButton: document.querySelector<HTMLButtonElement>("#closeMissionButton")!,
  qualityButton: document.querySelector<HTMLButtonElement>("#qualityButton")!,
  stabilityButton: document.querySelector<HTMLButtonElement>("#stabilityButton")!,
  gamepadStatus: text("gamepadStatus"),
  windValue: text("windValue"),
  windArrow: text("windArrow"),
  swellValue: text("swellValue"),
  replayTimeline: text("replayTimeline"),
  replayScrubber: document.querySelector<HTMLInputElement>("#replayScrubber")!,
  replayTime: text("replayTime"),
  attitudeHorizon: document.querySelector<HTMLElement>("#attitudeHorizon")!,
  gimbalMarker: document.querySelector<HTMLElement>("#gimbalMarker")!,
};

applyMissionPresentation();
renderMissionList();
applyQuality();
bindInputs();
resize();
window.addEventListener("resize", resize);
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  setPaused(true);
  showModal("RENDERER PAUSED", "Graphics context was interrupted. The simulator will recover when it returns.", "WAITING", "SYSTEM");
});
canvas.addEventListener("webglcontextrestored", () => {
  hideModal();
  setPaused(false);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.phase === "flying") setPaused(true);
});
renderer.setAnimationLoop(frame);

function frame(now: number) {
  const elapsed = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  const pad = pollGamepad(flightInputBlocked() ? { ...controls } : controls);
  ui.gamepadStatus.textContent = pad.connected ? "GAMEPAD: CONNECTED" : "GAMEPAD: NOT DETECTED";
  if (replaying && !paused) {
    replayTime = Math.min(recorder.duration, replayTime + elapsed);
    const sample = recorder.sample(replayTime);
    if (sample) applyReplayState(state, sample);
    if (replayTime >= recorder.duration) paused = true;
  } else if (!paused && !flightInputBlocked()) {
    accumulator += elapsed * simulationRate;
    while (accumulator >= fixedDt) {
      applyLandingAssist();
      stepFlight(state, controls, fixedDt);
      recorder.record(state);
      accumulator -= fixedDt;
    }
  }
  updateWorld(now / 1000, elapsed);
  updateUi();
  flightAudio.update(state.throttle, Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z), state.stress, state.phase);
  composer.render();
}

function updateWorld(visualTime: number, dt: number) {
  const pose = deckPose(state.time, state.seaState);
  ship.position.y = pose.y;
  ship.rotation.set(pose.pitch, 0, pose.roll);
  landingMarker.position.y = pose.y + 0.23;
  landingMarker.rotation.set(-Math.PI / 2 + pose.pitch, 0, pose.roll);

  rocket.position.set(state.position.x, state.position.y, state.position.z);
  rocket.rotation.order = "XYZ";
  rocket.rotation.set(state.tiltX, 0, state.tiltZ);

  const flame = rocket.userData.flame as THREE.Group;
  const flameScale = state.phase === "flying" && state.fuel > 0 ? state.throttle * (0.9 + Math.sin(visualTime * 52) * 0.08) : 0;
  flame.scale.set(1 + flameScale * 0.2, flameScale, 1 + flameScale * 0.2);
  flame.visible = flameScale > 0.02;

  const plumeMat = flame.userData.shaderMat as THREE.ShaderMaterial | undefined;
  if (plumeMat) {
    plumeMat.uniforms.uTime.value = visualTime;
    plumeMat.uniforms.uThrottle.value = state.throttle;
  }
  const engineLight = flame.userData.light as THREE.PointLight;
  engineLight.intensity = flameScale * 28 + Math.sin(visualTime * 42) * 4;

  if (state.throttle > 0.2 && state.phase === "flying") {
    engineThermalHeat = Math.min(1, engineThermalHeat + dt * 0.9);
  } else {
    engineThermalHeat = Math.max(0, engineThermalHeat - dt * 0.12);
  }
  const nozzleMesh = rocket.userData.centerNozzle as THREE.Mesh;
  if (nozzleMesh) {
    ((nozzleMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = engineThermalHeat * 4.2);
  }

  flame.rotation.x = state.gimbal.x * 0.88;
  flame.rotation.z = state.gimbal.z * 0.88;

  const rcsActive =
    state.phase === "flying" &&
    (controls.forward ||
      controls.back ||
      controls.left ||
      controls.right ||
      Math.abs(controls.assistTiltX ?? 0) > 0.02 ||
      Math.abs(controls.assistTiltZ ?? 0) > 0.02);

  updateExhaustTrail(exhaust, visualTime, dt, flameScale);
  updateRcsPuffs(rcsPuffs, dt, rcsActive);
  const deckY = deckHeightAt(state.position.x, state.position.z, state.time, state.seaState);
  const altitude = Math.max(0, state.position.y - ROCKET_HALF_HEIGHT - deckY);
  updateGroundWash(groundWash, dt, altitude, state.throttle, state.position.x, deckY, state.position.z);
  updateImpactEffect(impactEffect, dt);
  updateTrajectoryLine(trajectoryLine);

  const feet = rocket.userData.feet as THREE.Mesh[];
  feet.forEach((foot, index) => (foot.position.y = -2.82 + (state.legCompression[index] ?? 0) * 0.14));

  clouds.children.forEach((cloud, index) => {
    cloud.position.x += dt * (0.32 + (index % 3) * 0.07);
    if (cloud.position.x > 120) cloud.position.x = -120;
  });

  const water = ocean.material as THREE.ShaderMaterial;
  water.uniforms.uTime.value = visualTime;
  water.uniforms.uSeaState.value = state.seaState;

  // Camera Management
  orbit.enabled = cameraMode === 2 && !interactionBlocked();
  const desired = new THREE.Vector3();
  const target = new THREE.Vector3();

  if (cameraMode === 0) {
    // CHASE
    desired.set(state.position.x + 23, state.position.y + 12, state.position.z + 29);
    target.set(state.position.x * 0.35, Math.max(3, state.position.y - 7), state.position.z * 0.25);
    if (camera.aspect < 1) {
      const frame = portraitChaseFrame(state.position, camera.aspect, camera.fov);
      desired.copy(frame.desired);
      target.copy(frame.target);
    }
  } else if (cameraMode === 1) {
    // DECK VIEW
    desired.set(-22, 11, 28);
    target.set(state.position.x, Math.max(3, state.position.y), state.position.z);
  } else if (cameraMode === 2) {
    // ORBIT
    orbit.target.lerp(new THREE.Vector3(state.position.x * 0.3, Math.max(3, state.position.y * 0.35), state.position.z * 0.2), 1 - Math.exp(-dt * 2));
    orbit.update();
  } else if (cameraMode === 3) {
    // OCTAWEB (Onboard downward camera)
    desired.set(state.position.x + Math.sin(visualTime * 0.5) * 0.1, state.position.y - 1.6, state.position.z);
    target.set(state.position.x + state.gimbal.z * 1.5, 0, state.position.z + state.gimbal.x * 1.5);
  } else if (cameraMode === 4) {
    // BARGE MAST TRACKING
    desired.set(4.6, ship.position.y + 8.5, 11.5);
    target.set(state.position.x, state.position.y, state.position.z);
  }

  if (cameraMode !== 2) {
    const ease = cameraMode === 3 ? 1 - Math.exp(-dt * 18) : 1 - Math.exp(-dt * 2.8);
    camera.position.lerp(desired, ease);
    if (!reducedMotion.matches && state.phase === "flying" && state.throttle > 0.35) {
      const shake = (state.throttle * 0.024 + state.stress * 0.015) * (cameraMode === 3 ? 1.8 : 1);
      camera.position.x += Math.sin(visualTime * 47) * shake;
      camera.position.y += Math.sin(visualTime * 53) * shake;
    }
    camera.lookAt(target);
  }

  if (state.phase !== "flying" && !endShown) {
    endShown = true;
    pulseGamepad(state.phase === "landed" ? 0.38 : 1, state.phase === "landed" ? 180 : 650);
    triggerImpactEffect(impactEffect, state.phase === "crashed");
    ui.replayButton.disabled = !recorder.hasReplay;
    if (state.phase === "landed") {
      recordLanding(records, state.missionId, state.touchdownScore);
      renderMissionList();
    }
    endTimer = window.setTimeout(() => {
      if (state.phase !== "flying" && !replaying && !drawerOpen && !flightMenuOpen) showEndState();
    }, 500);
  }
}

function createSky() {
  const geometry = new THREE.SphereGeometry(280, 36, 18);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x315c70) },
      horizonColor: { value: new THREE.Color(0xb3c3c1) },
      bottomColor: { value: new THREE.Color(0x536e72) },
      sunDirection: { value: new THREE.Vector3(-0.48, 0.66, -0.25).normalize() },
      uNight: { value: 0 },
    },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.); vWorld=normalize(w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor; uniform vec3 sunDirection; uniform float uNight; varying vec3 vWorld;
      void main(){ float h=clamp(vWorld.y*.5+.5,0.,1.); vec3 col=mix(bottomColor,horizonColor,smoothstep(.35,.52,h)); col=mix(col,topColor,smoothstep(.52,.9,h)); float sun=pow(max(dot(vWorld,sunDirection),0.),420.); float haze=pow(max(dot(vWorld,sunDirection),0.),12.); col+=vec3(1.,.65,.35)*sun*(4.0-uNight*3.2)+vec3(1.,.46,.2)*haze*(.22-uNight*.18); gl_FragColor=vec4(col,1.); }`,
  });
  return new THREE.Mesh(geometry, material);
}

function makeCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 128);
  const blobs = [
    [60, 76, 45],
    [105, 55, 56],
    [150, 68, 48],
    [190, 78, 36],
  ];
  for (const [x, y, r] of blobs) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(235,242,239,.52)");
    gradient.addColorStop(0.52, "rgba(220,231,230,.24)");
    gradient.addColorStop(1, "rgba(210,222,222,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createClouds() {
  const group = new THREE.Group();
  const texture = makeCloudTexture();
  const positions = [
    [-72, 40, -80],
    [18, 33, -105],
    [72, 46, -62],
    [-90, 30, 8],
    [88, 37, 16],
    [-28, 55, -120],
    [48, 28, 82],
  ];
  positions.forEach(([x, y, z], i) => {
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.48 + (i % 3) * 0.08, depthWrite: false, fog: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(46 + (i % 2) * 18, 20 + (i % 2) * 7, 1);
    group.add(sprite);
  });
  return group;
}

// -------------------------------------------------------------
// Procedural Water Normal Map & Gerstner Ocean Shader
// -------------------------------------------------------------
function makeWaterNormalTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(256, 256);
  const data = imgData.data;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = (x / 256) * Math.PI * 4;
      const v = (y / 256) * Math.PI * 4;
      const dx = Math.cos(u * 2 + v) * 0.35 + Math.cos(u * 5 - v * 2) * 0.22 + Math.sin(u * 8 + v * 6) * 0.12;
      const dy = Math.sin(u + v * 2) * 0.35 + Math.sin(u * 3 - v * 5) * 0.22 + Math.cos(u * 6 - v * 7) * 0.12;
      const nx = -dx * 0.45;
      const ny = -dy * 0.45;
      const nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      const idx = (y * 256 + x) * 4;
      data[idx] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function createOcean() {
  const normalMap = makeWaterNormalTexture();
  const geometry = new THREE.PlaneGeometry(600, 600, 110, 110);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSeaState: { value: 1.0 },
      uNormalMap: { value: normalMap },
      uDeep: { value: new THREE.Color(0x04131b) },
      uTop: { value: new THREE.Color(0x15434d) },
      uSunDir: { value: new THREE.Vector3(-0.48, 0.66, -0.25).normalize() },
      uSunColor: { value: new THREE.Color(0xfff3dc) },
      uNight: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uSeaState;
      varying float vWave;
      varying vec3 vWorld;
      varying vec3 vNormal;

      void main() {
        vec3 p = position;
        float t = uTime;
        float sea = max(0.35, uSeaState);

        // 4 Gerstner Wave components
        vec2 d1 = normalize(vec2(0.8, 0.6));
        float a1 = 0.24 * sea;
        float f1 = 0.085;
        float s1 = 1.05;

        vec2 d2 = normalize(vec2(-0.55, 0.83));
        float a2 = 0.16 * sea;
        float f2 = 0.13;
        float s2 = 1.35;

        vec2 d3 = normalize(vec2(0.92, -0.38));
        float a3 = 0.09 * sea;
        float f3 = 0.26;
        float s3 = 1.85;

        vec2 d4 = normalize(vec2(-0.42, -0.91));
        float a4 = 0.045 * sea;
        float f4 = 0.48;
        float s4 = 2.4;

        float phase1 = dot(d1, p.xy) * f1 + t * s1;
        float phase2 = dot(d2, p.xy) * f2 + t * s2;
        float phase3 = dot(d3, p.xy) * f3 + t * s3;
        float phase4 = dot(d4, p.xy) * f4 + t * s4;

        p.x -= (0.5 * a1 * d1.x * sin(phase1) + 0.4 * a2 * d2.x * sin(phase2) + 0.3 * a3 * d3.x * sin(phase3) + 0.2 * a4 * d4.x * sin(phase4));
        p.y -= (0.5 * a1 * d1.y * sin(phase1) + 0.4 * a2 * d2.y * sin(phase2) + 0.3 * a3 * d3.y * sin(phase3) + 0.2 * a4 * d4.y * sin(phase4));
        p.z = a1 * cos(phase1) + a2 * cos(phase2) + a3 * cos(phase3) + a4 * cos(phase4);

        vWave = p.z;

        float wa1 = f1 * a1, wa2 = f2 * a2, wa3 = f3 * a3, wa4 = f4 * a4;
        float dZx = -(d1.x * wa1 * sin(phase1) + d2.x * wa2 * sin(phase2) + d3.x * wa3 * sin(phase3) + d4.x * wa4 * sin(phase4));
        float dZy = -(d1.y * wa1 * sin(phase1) + d2.y * wa2 * sin(phase2) + d3.y * wa3 * sin(phase3) + d4.y * wa4 * sin(phase4));

        vec3 localNormal = normalize(vec3(-dZx, -dZy, 1.0));
        vNormal = normalize(mat3(modelMatrix) * localNormal);

        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform sampler2D uNormalMap;
      uniform vec3 uDeep;
      uniform vec3 uTop;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uNight;
      varying float vWave;
      varying vec3 vWorld;
      varying vec3 vNormal;

      void main() {
        // Dual scrolling micro-ripple normal sampling
        vec2 uv1 = vWorld.xz * 0.07 + vec2(uTime * 0.035, uTime * 0.025);
        vec2 uv2 = vWorld.xz * 0.16 - vec2(uTime * 0.05, -uTime * 0.04);
        vec3 n1 = texture2D(uNormalMap, uv1).rgb * 2.0 - 1.0;
        vec3 n2 = texture2D(uNormalMap, uv2).rgb * 2.0 - 1.0;
        vec3 microNormal = normalize(vec3(n1.x + n2.x * 0.5, n1.z + n2.z * 0.5, n1.y + n2.y * 0.5));

        vec3 n = normalize(vNormal + microNormal * 0.35);
        if (n.y < 0.0) n = -n;

        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 4.2);

        vec3 sunDir = normalize(uSunDir);
        vec3 halfVec = normalize(sunDir + viewDir);
        float spec = pow(max(dot(n, halfVec), 0.0), 160.0);

        float sss = pow(max(dot(viewDir, -sunDir), 0.0), 2.0) * max(0.0, vWave + 0.32) * (1.0 - uNight * 0.85);
        vec3 sssColor = vec3(0.04, 0.45, 0.4) * sss * 0.8;

        float foamThresh = 0.27 - uNight * 0.04;
        float foam = smoothstep(foamThresh, foamThresh + 0.25, vWave) * 0.44;

        vec3 base = mix(uDeep, uTop, clamp(vWave * 0.65 + 0.5, 0.0, 1.0));
        vec3 col = base + sssColor;
        col += fres * (uNight > 0.5 ? vec3(0.05, 0.09, 0.16) : vec3(0.18, 0.38, 0.45));
        col += spec * uSunColor * (uNight > 0.5 ? 0.75 : 2.8);
        col += foam * (uNight > 0.5 ? vec3(0.35, 0.45, 0.55) : vec3(0.92, 0.96, 0.98));

        gl_FragColor = vec4(col, 0.98);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -2.2;
  mesh.receiveShadow = true;
  return mesh;
}

// -------------------------------------------------------------
// Drone Ship (ASDS Odyssey) High-Detail PBR Model & Floodlights
// -------------------------------------------------------------
interface ShipData {
  group: THREE.Group;
  spotlights: THREE.SpotLight[];
}

function makeDeckPbrTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 2048;
  const ctx = canvas.getContext("2d")!;

  // Base steel tarmac
  ctx.fillStyle = "#1e2424";
  ctx.fillRect(0, 0, 1024, 2048);

  // Tie-down grid markings
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 2;
  for (let x = 80; x < 1024; x += 110) {
    ctx.beginPath();
    ctx.moveTo(x, 80);
    ctx.lineTo(x, 1968);
    ctx.stroke();
  }
  for (let y = 80; y < 2048; y += 140) {
    ctx.beginPath();
    ctx.moveTo(80, y);
    ctx.lineTo(944, y);
    ctx.stroke();
  }

  // SpaceX Style Giant "X" Landing Target Crosshair
  ctx.save();
  ctx.translate(512, 1024);
  ctx.strokeStyle = "#f15b2a";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(0, 0, 260, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#e2e6e3";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(0, 0, 85, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshair spokes
  ctx.fillStyle = "#f15b2a";
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.fillRect(-8, 140, 16, 120);
  }
  ctx.restore();

  // Name & Spaceport Typography
  ctx.font = "700 82px 'Barlow Condensed', sans-serif";
  ctx.fillStyle = "#dce3dd";
  ctx.textAlign = "center";
  ctx.fillText("ODYSSEY", 512, 380);
  ctx.fillText("ODYSSEY", 512, 1668);

  ctx.font = "600 32px 'DM Mono', monospace";
  ctx.fillStyle = "#f15b2a";
  ctx.fillText("AUTONOMOUS SPACEPORT DRONE SHIP", 512, 440);
  ctx.fillText("LZ-1 OFFSHORE RECOVERY", 512, 1728);

  // Wet glossy puddle patches (noise overlay)
  for (let i = 0; i < 35; i++) {
    const px = Math.random() * 900 + 60;
    const py = Math.random() * 1900 + 60;
    const pr = 40 + Math.random() * 90;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, pr);
    grad.addColorStop(0, "rgba(8,16,18,0.45)");
    grad.addColorStop(1, "rgba(8,16,18,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function createShip(): ShipData {
  const group = new THREE.Group();
  const spotlights: THREE.SpotLight[] = [];

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x11191b, roughness: 0.72, metalness: 0.55 });
  const deckTexture = makeDeckPbrTexture();
  const deckMat = new THREE.MeshStandardMaterial({
    map: deckTexture,
    roughness: 0.42,
    metalness: 0.48,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xadb4ad, roughness: 0.55, metalness: 0.25 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xf15b2a, roughness: 0.65, metalness: 0.2 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1f4b75, roughness: 0.65, metalness: 0.2 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x1c2122, roughness: 0.4, metalness: 0.8 });

  // Main Hull
  const hull = new THREE.Mesh(createHullGeometry(), hullMat);
  hull.castShadow = hull.receiveShadow = true;
  group.add(hull);

  // Deck plane with high-res PBR texture
  const deck = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.42, 32), deckMat);
  deck.position.y = 0.02;
  deck.castShadow = deck.receiveShadow = true;
  group.add(deck);

  // Forward Command Superstructure (Tiered Container Blocks)
  const mainBridge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.8, 4.8), white);
  mainBridge.position.set(4.6, 2.1, 10.4);
  mainBridge.castShadow = true;
  group.add(mainBridge);

  const upperBridge = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 3.4), white);
  upperBridge.position.set(4.6, 4.8, 10.2);
  upperBridge.castShadow = true;
  group.add(upperBridge);

  const windowMat = new THREE.MeshStandardMaterial({ color: 0x7dabc0, emissive: 0x183742, emissiveIntensity: 2.2 });
  const windows = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.9, 2.2), windowMat);
  windows.position.set(4.6, 4.9, 8.8);
  group.add(windows);

  // Blast Deflector Wall behind landing pad
  const deflector = new THREE.Mesh(new THREE.BoxGeometry(10.5, 1.6, 0.35), darkSteel);
  deflector.position.set(0, 1.0, 7.2);
  deflector.castShadow = true;
  group.add(deflector);

  // Cargo Shipping Containers (Intermodal Stack)
  const containerDefs = [
    { x: -4.8, y: 1.1, z: 9.8, w: 2.2, h: 1.8, d: 4.8, mat: orange },
    { x: -4.8, y: 2.8, z: 9.8, w: 2.2, h: 1.6, d: 4.6, mat: blue },
    { x: -2.4, y: 1.1, z: 11.2, w: 2.0, h: 1.8, d: 3.4, mat: white },
  ];
  containerDefs.forEach((c) => {
    const cont = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), c.mat);
    cont.position.set(c.x, c.y, c.z);
    cont.castShadow = true;
    group.add(cont);
  });

  // Radar Domes & Antenna Arrays
  const radar1 = new THREE.Mesh(new THREE.SphereGeometry(0.72, 18, 12), white);
  radar1.position.set(4.6, 6.2, 10.5);
  group.add(radar1);

  const radar2 = new THREE.Mesh(new THREE.SphereGeometry(0.48, 14, 10), orange);
  radar2.position.set(3.4, 5.9, 11.8);
  group.add(radar2);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 7.5, 8), darkSteel);
  mast.position.set(4.6, 8.5, 11.2);
  group.add(mast);

  // Lattice Crane with Boom
  const craneBase = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.8, 12), orange);
  craneBase.position.set(-5.4, 1.1, 12.8);
  group.add(craneBase);

  const craneArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 9.5), orange);
  craneArm.position.set(-5.4, 3.8, 8.6);
  craneArm.rotation.x = -0.24;
  craneArm.castShadow = true;
  group.add(craneArm);

  // Perimeter Safety Railings & Bitts
  for (const x of [-6.95, 6.95]) {
    const rail = new THREE.Group();
    for (let z = -14; z <= 14; z += 2.2) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), white);
      post.position.set(x, 0.7, z);
      rail.add(post);
    }
    for (const y of [0.55, 0.88]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 28, 6), white);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(x, y, 0);
      rail.add(bar);
    }
    group.add(rail);
  }

  // 4 High-Power Corner Floodlight Gantry Towers
  const cornerPositions = [
    [-6.5, 3.6, -13.2],
    [6.5, 3.6, -13.2],
    [-6.5, 3.6, 13.2],
    [6.5, 3.6, 13.2],
  ];
  const targetObj = new THREE.Object3D();
  targetObj.position.set(0, 0.2, 0);
  group.add(targetObj);

  cornerPositions.forEach(([x, y, z]) => {
    // Truss post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.6, 8), darkSteel);
    post.position.set(x, y - 1.7, z);
    group.add(post);

    const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.35), darkSteel);
    fixture.position.set(x, y, z);
    group.add(fixture);

    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffeedd }));
    bulb.position.set(x, y, z);
    group.add(bulb);

    const spot = new THREE.SpotLight(0xffeedd, 40, 55, 0.58, 0.7, 1.8);
    spot.position.set(x, y, z);
    spot.target = targetObj;
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0002;
    group.add(spot);
    spotlights.push(spot);
  });

  return { group, spotlights };
}

function createHullGeometry() {
  const outline = [
    [-7.5, 17],
    [7.5, 17],
    [7.5, -13],
    [0, -21],
    [-7.5, -13],
  ];
  const positions: number[] = [];
  outline.forEach(([x, z]) => positions.push(x, 0, z));
  outline.forEach(([x, z]) => positions.push(x * 0.84, -3.9, z + 0.35));
  const indices: number[] = [];
  indices.push(0, 1, 2, 0, 2, 3, 0, 3, 4);
  indices.push(5, 7, 6, 5, 8, 7, 5, 9, 8);
  for (let i = 0; i < 5; i++) {
    const n = (i + 1) % 5;
    indices.push(i, n, 5 + n, i, 5 + n, 5 + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createLandingMarker() {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf3eee5, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.38, 64), ringMat);
  group.add(ring);
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.03, 48), ringMat);
  group.add(inner);
  for (let i = 0; i < 4; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 1.2), ringMat);
    const a = (i * Math.PI) / 2;
    stripe.position.set(Math.sin(a) * 2.2, Math.cos(a) * 2.2, 0);
    stripe.rotation.z = -a;
    group.add(stripe);
  }
  return group;
}

// -------------------------------------------------------------
// Falcon-Style Rocket with 9-Engine Octaweb Cluster & Soot PBR
// -------------------------------------------------------------
function makeRocketSkinTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;

  // Off-white composite fuselage
  ctx.fillStyle = "#e5e9e6";
  ctx.fillRect(0, 0, 512, 1024);

  // Circumferential tank weld rings
  ctx.strokeStyle = "rgba(45,55,58,0.25)";
  ctx.lineWidth = 3;
  for (const y of [220, 410, 600, 780]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  // Re-entry carbon soot scorch gradient
  const soot = ctx.createLinearGradient(0, 380, 0, 1024);
  soot.addColorStop(0, "rgba(229,233,230,0)");
  soot.addColorStop(0.35, "rgba(65,72,75,0.35)");
  soot.addColorStop(0.75, "rgba(30,34,36,0.78)");
  soot.addColorStop(1, "rgba(16,18,20,0.95)");
  ctx.fillStyle = soot;
  ctx.fillRect(0, 380, 512, 644);

  // Thermal streak flow lines
  for (let i = 0; i < 55; i++) {
    const x = Math.random() * 512;
    const w = 3 + Math.random() * 14;
    const h = 220 + Math.random() * 450;
    const y = 460 + Math.random() * 320;
    ctx.fillStyle = `rgba(12,15,16,${0.08 + Math.random() * 0.22})`;
    ctx.fillRect(x, y, w, h);
  }

  // Insignia & Identification
  ctx.save();
  ctx.translate(256, 300);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "700 26px 'DM Mono', monospace";
  ctx.fillStyle = "rgba(32,40,42,0.8)";
  ctx.textAlign = "center";
  ctx.fillText("S/L BOOSTER • B-1067", 0, 0);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function createRocket() {
  const group = new THREE.Group();
  const feet: THREE.Mesh[] = [];

  const skinTexture = makeRocketSkinTexture();
  const bodyMat = new THREE.MeshStandardMaterial({
    map: skinTexture,
    roughness: 0.44,
    metalness: 0.52,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x141818, roughness: 0.5, metalness: 0.65 });
  const titaniumMat = new THREE.MeshStandardMaterial({ color: 0x3d4345, roughness: 0.28, metalness: 0.88 });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x181c1e,
    emissive: 0xff5a1f,
    emissiveIntensity: 0,
    roughness: 0.35,
    metalness: 0.85,
  });
  const outerNozzleMat = new THREE.MeshStandardMaterial({
    color: 0x22282a,
    roughness: 0.38,
    metalness: 0.82,
  });

  // Fuselage Cylinder
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.88, 4.3, 32), bodyMat);
  body.position.y = 0.25;
  body.castShadow = true;
  group.add(body);

  // Nosecone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.4, 32), bodyMat);
  nose.position.y = 3.1;
  nose.castShadow = true;
  group.add(nose);

  // External Cable Raceway Conduit running down fuselage
  const raceway = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.2, 0.08), darkMat);
  raceway.position.set(0.77, 0.25, 0);
  raceway.castShadow = true;
  group.add(raceway);

  // Interstage Band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.77, 0.77, 0.48, 32), darkMat);
  band.position.y = 1.45;
  group.add(band);

  const accentMat = new THREE.MeshStandardMaterial({ color: 0xf15b2a, roughness: 0.52, metalness: 0.45 });
  const accent = new THREE.Mesh(new THREE.CylinderGeometry(0.79, 0.79, 0.12, 32), accentMat);
  accent.position.y = 0.92;
  group.add(accent);

  // -----------------------------------------------------------
  // Octaweb Base Plate & 9-Engine Merlin Cluster
  // -----------------------------------------------------------
  const heatShield = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.82, 0.25, 32), darkMat);
  heatShield.position.y = -1.98;
  group.add(heatShield);

  // Center Engine (Gimbaling & Thermal Heat)
  const centerEngine = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 0.55, 20), nozzleMat);
  centerEngine.position.y = -2.25;
  group.add(centerEngine);

  // 8 Outer Engines surrounding center engine in circle
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const outerEngine = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.45, 16), outerNozzleMat);
    outerEngine.position.set(Math.sin(a) * 0.48, -2.2, Math.cos(a) * 0.48);
    group.add(outerEngine);
  }

  // -----------------------------------------------------------
  // 3D Waffle Grid Fins with Cross-Lattice
  // -----------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const finGroup = new THREE.Group();
    const mainFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 0.72), titaniumMat);
    finGroup.add(mainFrame);

    // Cross-lattice waffle bars
    for (const offset of [-0.22, 0, 0.22]) {
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.68), titaniumMat);
      hBar.position.y = offset;
      const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.68, 0.035), titaniumMat);
      vBar.position.z = offset;
      finGroup.add(hBar, vBar);
    }
    // Hinge bracket
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 12), darkMat);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(-0.06, 0, 0);
    finGroup.add(hinge);

    finGroup.position.set(Math.sin(a) * 0.94, 1.73, Math.cos(a) * 0.94);
    finGroup.rotation.y = a;
    finGroup.castShadow = true;
    group.add(finGroup);
  }

  // -----------------------------------------------------------
  // Deployable Carbon-Fiber Landing Legs with Hydraulic Pistons
  // -----------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    // Main A-frame carbon leg
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.25, 0.14), darkMat);
    leg.position.set(Math.sin(a) * 0.78, -1.75, Math.cos(a) * 0.78);
    leg.rotation.z = Math.sin(a) * -0.32;
    leg.rotation.x = Math.cos(a) * 0.32;
    group.add(leg);

    // Telescoping Chrome Hydraulic Piston
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.7, 10), titaniumMat);
    piston.position.set(Math.sin(a) * 0.52, -1.9, Math.cos(a) * 0.52);
    piston.rotation.z = Math.sin(a) * -0.44;
    piston.rotation.x = Math.cos(a) * 0.44;
    group.add(piston);

    // Articulated landing footpad
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.52), darkMat);
    foot.position.set(Math.sin(a) * 1.15, -2.82, Math.cos(a) * 1.15);
    group.add(foot);
    feet.push(foot);
  }

  // -----------------------------------------------------------
  // Supersonic Shock-Diamond Plume
  // -----------------------------------------------------------
  const flame = new THREE.Group();

  const plumeShaderMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uThrottle: { value: 1.0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uThrottle;
      varying vec2 vUv;

      void main() {
        float y = vUv.y;
        float diamondFreq = 16.0;
        float diamond = pow(sin(y * diamondFreq - uTime * 48.0) * 0.5 + 0.5, 4.0);

        float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
        radial = smoothstep(0.0, 0.6, radial);

        vec3 coreColor = vec3(1.0, 0.98, 0.88);
        vec3 midColor = vec3(1.0, 0.52, 0.12);
        vec3 outerColor = vec3(0.95, 0.22, 0.03);

        vec3 col = mix(outerColor, midColor, radial);
        col = mix(col, coreColor, radial * radial * (1.0 - y * 0.65));
        col += vec3(1.0, 0.95, 0.75) * diamond * radial * (1.0 - y * 0.75) * 2.2;

        float alpha = (1.0 - y * 0.85) * radial * clamp(uThrottle * 1.2, 0.0, 1.0) * 0.88;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const plumeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.82, 3.8, 20, 1, true), plumeShaderMat);
  plumeMesh.position.y = -4.15;
  flame.add(plumeMesh);

  // Inner needle cone
  const innerNeedle = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 2.4, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  innerNeedle.rotation.x = Math.PI;
  innerNeedle.position.y = -3.5;
  flame.add(innerNeedle);

  const engineLight = new THREE.PointLight(0xff6a28, 0, 16, 2);
  engineLight.position.y = -3.05;
  flame.add(engineLight);

  flame.userData.light = engineLight;
  flame.userData.shaderMat = plumeShaderMat;

  group.add(flame);
  group.userData.flame = flame;
  group.userData.feet = feet;
  group.userData.centerNozzle = centerEngine;
  return group;
}

// -------------------------------------------------------------
// Cold-Gas Nitrogen RCS Puffs
// -------------------------------------------------------------
interface RcsSystem {
  points: THREE.Points;
  positions: Float32Array;
  particles: Array<{ life: number; velocity: THREE.Vector3; startPos: THREE.Vector3 }>;
  cursor: number;
}

function createRcsPuffs(): RcsSystem {
  const count = 48;
  const positions = new Float32Array(count * 3);
  positions.fill(999);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size: 0.55,
    color: 0xebf4f8,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  const particles = Array.from({ length: count }, () => ({
    life: 0,
    velocity: new THREE.Vector3(),
    startPos: new THREE.Vector3(),
  }));
  return { points, positions, particles, cursor: 0 };
}

function updateRcsPuffs(rcs: RcsSystem, dt: number, active: boolean) {
  if (active && !paused) {
    const thrusters = [
      { x: 0.93, y: 1.73, z: 0, dx: 4.5, dz: 0 },
      { x: -0.93, y: 1.73, z: 0, dx: -4.5, dz: 0 },
      { x: 0, y: 1.73, z: 0.93, dx: 0, dz: 4.5 },
      { x: 0, y: 1.73, z: -0.93, dx: 0, dz: -4.5 },
    ];
    thrusters.forEach((th) => {
      const idx = rcs.cursor++ % rcs.particles.length;
      const p = rcs.particles[idx];
      p.life = 0.22 + Math.random() * 0.12;
      p.startPos.set(state.position.x + th.x, state.position.y + th.y, state.position.z + th.z);
      p.velocity.set(th.dx + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, th.dz + (Math.random() - 0.5) * 1.5);
      rcs.positions[idx * 3] = p.startPos.x;
      rcs.positions[idx * 3 + 1] = p.startPos.y;
      rcs.positions[idx * 3 + 2] = p.startPos.z;
    });
  }

  rcs.particles.forEach((p, i) => {
    if (p.life <= 0) return;
    p.life -= dt;
    rcs.positions[i * 3] += p.velocity.x * dt;
    rcs.positions[i * 3 + 1] += p.velocity.y * dt;
    rcs.positions[i * 3 + 2] += p.velocity.z * dt;
    if (p.life <= 0) {
      rcs.positions[i * 3] = rcs.positions[i * 3 + 1] = rcs.positions[i * 3 + 2] = 999;
    }
  });
  (rcs.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}

// -------------------------------------------------------------
// Ground Wash & Radial Smoke Ring
// -------------------------------------------------------------
interface GroundWash {
  points: THREE.Points;
  positions: Float32Array;
  particles: Array<{ life: number; velocity: THREE.Vector3 }>;
  cursor: number;
}

function createGroundWash(): GroundWash {
  const count = 96;
  const positions = new Float32Array(count * 3);
  positions.fill(999);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size: 1.8,
    color: 0xdde7e8,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  const particles = Array.from({ length: count }, () => ({
    life: 0,
    velocity: new THREE.Vector3(),
  }));
  return { points, positions, particles, cursor: 0 };
}

function updateGroundWash(gw: GroundWash, dt: number, altitude: number, throttle: number, rx: number, deckY: number, rz: number) {
  if (altitude < 14 && throttle > 0.15 && state.phase === "flying" && !paused) {
    const spawnCount = Math.floor(dt * 60 * throttle);
    for (let s = 0; s < spawnCount; s++) {
      const idx = gw.cursor++ % gw.particles.length;
      const p = gw.particles[idx];
      p.life = 0.65 + Math.random() * 0.45;
      const angle = Math.random() * Math.PI * 2;
      const speed = 7 + throttle * 12 + Math.random() * 4;
      p.velocity.set(Math.cos(angle) * speed, (Math.random() - 0.2) * 1.5, Math.sin(angle) * speed);
      gw.positions[idx * 3] = rx + Math.cos(angle) * 0.8;
      gw.positions[idx * 3 + 1] = deckY + 0.15;
      gw.positions[idx * 3 + 2] = rz + Math.sin(angle) * 0.8;
    }
  }

  gw.particles.forEach((p, i) => {
    if (p.life <= 0) return;
    p.life -= dt;
    gw.positions[i * 3] += p.velocity.x * dt;
    gw.positions[i * 3 + 1] += p.velocity.y * dt;
    gw.positions[i * 3 + 2] += p.velocity.z * dt;
    if (p.life <= 0) {
      gw.positions[i * 3] = gw.positions[i * 3 + 1] = gw.positions[i * 3 + 2] = 999;
    }
  });
  (gw.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}

// -------------------------------------------------------------
// 3D Predictive Landing Trajectory Line
// -------------------------------------------------------------
function createTrajectoryLine() {
  const pointsCount = 20;
  const positions = new Float32Array(pointsCount * 3);
  const colors = new Float32Array(pointsCount * 3);
  for (let i = 0; i < pointsCount; i++) {
    const t = i / (pointsCount - 1);
    colors[i * 3] = 0.4 + t * 0.6;
    colors[i * 3 + 1] = 0.9 - t * 0.5;
    colors[i * 3 + 2] = 0.9 - t * 0.8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    linewidth: 2,
  });
  return new THREE.Line(geometry, material);
}

function updateTrajectoryLine(line: THREE.Line) {
  if (state.phase !== "flying") {
    line.visible = false;
    return;
  }
  line.visible = true;
  const positions = (line.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
  let px = state.position.x;
  let py = state.position.y - 2.8;
  let pz = state.position.z;
  let vx = state.velocity.x;
  let vy = state.velocity.y;
  let vz = state.velocity.z;
  const dt = 0.12;

  for (let i = 0; i < 20; i++) {
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;

    vx += state.wind.currentX * dt * 0.12;
    vy -= 9.81 * dt * 0.7;
    vz += state.wind.currentZ * dt * 0.12;

    px += vx * dt;
    py += vy * dt;
    pz += vz * dt;

    if (py < 0) py = 0;
  }
  (line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}

// -------------------------------------------------------------
// Exhaust & Impact Particles
// -------------------------------------------------------------
interface ExhaustTrail {
  points: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  particles: Array<{ life: number; velocity: THREE.Vector3 }>;
  cursor: number;
  spawnCarry: number;
}

function createExhaustTrail(): ExhaustTrail {
  const count = 180;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  positions.fill(999);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const texture = makeParticleTexture();
  const material = new THREE.PointsMaterial({
    size: 1.3,
    map: texture,
    transparent: true,
    opacity: 0.55,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  const particles = Array.from({ length: count }, () => ({ life: 0, velocity: new THREE.Vector3() }));
  return { points, positions, colors, particles, cursor: 0, spawnCarry: 0 };
}

function makeParticleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.22, "rgba(255,210,140,.7)");
  gradient.addColorStop(1, "rgba(80,95,95,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function updateExhaustTrail(trail: ExhaustTrail, time: number, dt: number, power: number) {
  if (!paused && power > 0.08) {
    trail.spawnCarry += dt * (16 + power * 42);
    while (trail.spawnCarry >= 1) {
      trail.spawnCarry--;
      const i = trail.cursor++ % trail.particles.length;
      const p = trail.particles[i];
      p.life = 1.4 + Math.random() * 0.8;
      p.velocity.set((Math.random() - 0.5) * 0.75 - state.velocity.x * 0.08, -3.8 - power * 3 + Math.random(), (Math.random() - 0.5) * 0.75 - state.velocity.z * 0.08);
      trail.positions[i * 3] = state.position.x + (Math.random() - 0.5) * 0.28;
      trail.positions[i * 3 + 1] = state.position.y - 3.1;
      trail.positions[i * 3 + 2] = state.position.z + (Math.random() - 0.5) * 0.28;
    }
  }
  trail.particles.forEach((p, i) => {
    if (p.life <= 0) return;
    p.life -= dt;
    p.velocity.y += dt * 1.8;
    trail.positions[i * 3] += p.velocity.x * dt;
    trail.positions[i * 3 + 1] += p.velocity.y * dt;
    trail.positions[i * 3 + 2] += p.velocity.z * dt;
    const heat = Math.max(0, Math.min(1, p.life / 0.55));
    trail.colors[i * 3] = 0.42 + heat * 0.58;
    trail.colors[i * 3 + 1] = 0.48 + heat * 0.33;
    trail.colors[i * 3 + 2] = 0.5 + heat * 0.12;
    if (p.life <= 0) trail.positions[i * 3] = trail.positions[i * 3 + 1] = trail.positions[i * 3 + 2] = 999;
  });
  (trail.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (trail.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  trail.points.rotation.y = Math.sin(time * 0.08) * 0.001;
}

interface ImpactEffect {
  group: THREE.Group;
  sparks: THREE.Points;
  ring: THREE.Mesh;
  light: THREE.PointLight;
  positions: Float32Array;
  velocities: THREE.Vector3[];
  life: number;
  violent: boolean;
}

function createImpactEffect(): ImpactEffect {
  const group = new THREE.Group(),
    count = 72,
    positions = new Float32Array(count * 3),
    velocities = Array.from({ length: count }, () => new THREE.Vector3());
  positions.fill(999);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const sparks = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.18,
      color: 0xff7b32,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.82, 48),
    new THREE.MeshBasicMaterial({
      color: 0xff8a42,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  const light = new THREE.PointLight(0xff6328, 0, 24, 2);
  group.add(sparks, ring, light);
  group.visible = false;
  return { group, sparks, ring, light, positions, velocities, life: 0, violent: false };
}

function triggerImpactEffect(effect: ImpactEffect, violent: boolean) {
  effect.group.visible = true;
  effect.group.position.set(state.position.x, deckHeightAt(state.position.x, state.position.z, state.time, state.seaState) + 0.15, state.position.z);
  effect.life = violent ? 1.3 : 0.55;
  effect.violent = violent;
  effect.ring.scale.setScalar(1);
  effect.velocities.forEach((velocity, i) => {
    const a = Math.random() * Math.PI * 2,
      speed = (violent ? 4.5 : 1.8) * (0.35 + Math.random());
    velocity.set(Math.cos(a) * speed, Math.random() * (violent ? 5 : 1.5), Math.sin(a) * speed);
    effect.positions[i * 3] = effect.positions[i * 3 + 1] = effect.positions[i * 3 + 2] = 0;
  });
  ((effect.sparks.material as THREE.PointsMaterial).opacity = violent ? 0.92 : 0.38);
  effect.light.intensity = violent ? 55 : 12;
}

function updateImpactEffect(effect: ImpactEffect, dt: number) {
  if (effect.life <= 0) return;
  effect.life -= dt;
  effect.velocities.forEach((velocity, i) => {
    velocity.y -= 9.81 * dt;
    effect.positions[i * 3] += velocity.x * dt;
    effect.positions[i * 3 + 1] += velocity.y * dt;
    effect.positions[i * 3 + 2] += velocity.z * dt;
  });
  (effect.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  const fade = Math.max(0, effect.life / (effect.violent ? 1.3 : 0.55));
  ((effect.sparks.material as THREE.PointsMaterial).opacity = fade * (effect.violent ? 0.92 : 0.38));
  effect.ring.scale.addScalar(dt * (effect.violent ? 7 : 3));
  ((effect.ring.material as THREE.MeshBasicMaterial).opacity = fade * (effect.violent ? 0.55 : 0.18));
  effect.light.intensity = fade * (effect.violent ? 55 : 12);
  if (effect.life <= 0) effect.group.visible = false;
}

// -------------------------------------------------------------
// UI & HUD Update
// -------------------------------------------------------------
function updateUi() {
  const deckY = deckHeightAt(state.position.x, state.position.z, state.time, state.seaState);
  const altitude = Math.max(0, state.position.y - ROCKET_HALF_HEIGHT - deckY);
  const drift = Math.hypot(state.velocity.x, state.velocity.z);
  ui.altitude.textContent = altitude.toFixed(1).padStart(4, "0");
  ui.velocity.textContent = Math.abs(state.velocity.y).toFixed(1);
  ui.verticalDirection.textContent = state.velocity.y > .05 ? "CLIMB" : state.velocity.y < -.05 ? "DESCENT" : "VERT SPEED";
  ui.velocity.setAttribute("aria-label", `${ui.verticalDirection.textContent} ${Math.abs(state.velocity.y).toFixed(1)} meters per second`);
  ui.velocity.style.color = Math.abs(state.velocity.y) >= TOUCHDOWN_LIMITS.verticalSpeed && altitude < 10 ? "#ff5a1f" : "";
  ui.fuel.textContent = Math.round(state.fuel * 100).toString();
  ui.drift.textContent = drift.toFixed(1);
  ui.driftArrow.style.rotate = `${lateralMotionAngle(state.velocity, camera)}deg`;
  ui.driftArrow.style.visibility = drift > .05 ? "visible" : "hidden";
  const windSpeed = Math.hypot(state.wind.currentX, state.wind.currentZ);
  ui.windValue.textContent = windSpeed.toFixed(1);
  ui.windArrow.style.rotate = `${(Math.atan2(state.wind.currentX, -state.wind.currentZ) * 180) / Math.PI}deg`;
  ui.swellValue.textContent = state.seaState.toFixed(1);
  const percent = Math.round(state.throttle * 100);
  ui.throttle.value = percent.toString();
  ui.throttleValue.textContent = `${percent}%`;
  ui.touchThrottle.textContent = `${percent}%`;
  ui.throttle.style.setProperty("--fill", `${percent}%`);
  const feedback = getLandingReadiness(state);
  ui.callout.textContent = feedback.positionAligned ? "POSITION ALIGNED" : "ALIGN WITH TARGET";
  if (state.phase === "flying") {
    const cue = feedback.failureReasons.length ? feedback.correctiveTip : "Approach values within limits · contact still required";
    ui.status.textContent = `${assistEnabled ? "Autoland · " : ""}${cue}`;
  }
  if (replaying) {
    ui.status.textContent = "Flight replay telemetry";
    ui.replayScrubber.value = String(recorder.duration ? (replayTime / recorder.duration) * 100 : 0);
    ui.replayTime.textContent = formatTime(replayTime);
  }

  // Artificial Horizon Update
  if (ui.attitudeHorizon) {
    const rollDeg = (-state.tiltZ * 180) / Math.PI;
    const pitchOffset = ((state.tiltX * 180) / Math.PI) * 2.2;
    ui.attitudeHorizon.style.transform = `rotate(${rollDeg}deg) translateY(${pitchOffset}px)`;
  }
  if (ui.gimbalMarker) {
    ui.gimbalMarker.style.transform = `translate(${state.gimbal.z * 35}px, ${-state.gimbal.x * 35}px)`;
  }
}

function applyLandingAssist() {
  if (!assistEnabled || state.phase !== "flying") {
    controls.assistTiltX = controls.assistTiltZ = controls.assistThrottle = undefined;
    return;
  }
  updateLandingAssist(state, controls);
}

function bindInputs() {
  type DigitalControl = "forward" | "back" | "left" | "right" | "throttleUp" | "throttleDown";
  const keyMap: Record<string, DigitalControl> = {
    ArrowUp: "forward",
    ArrowDown: "back",
    ArrowLeft: "left",
    ArrowRight: "right",
    KeyW: "throttleUp",
    KeyS: "throttleDown",
    Space: "throttleUp",
    ShiftLeft: "throttleDown",
  };
  window.addEventListener("keydown", (event) => {
    void flightAudio.unlock();
    const editing = (event.target as HTMLElement).closest("input, button, summary");
    if (editing && ["Space", "Enter"].includes(event.code)) return;
    if ((event.target as HTMLElement).matches("input") && event.code.startsWith("Arrow")) return;
    if (event.code === "Escape" || event.code === "KeyP") {
      event.preventDefault();
      if (event.repeat) return;
      if (flightMenuOpen) toggleFlightMenu();
      else if (drawerOpen) toggleMissionDrawer();
      else if (ui.modalTitle.textContent !== "RENDERER PAUSED") togglePause();
      return;
    }
    if (replaying && !drawerOpen && !flightMenuOpen && ui.modal.classList.contains("hidden") && !event.repeat) {
      if (event.code === "KeyV") { toggleReplay(); return; }
      if (event.code === "KeyC") { changeCamera(); return; }
    }
    if (flightInputBlocked()) {
      if (event.code === "KeyM" && drawerOpen && !event.repeat) toggleMissionDrawer();
      return;
    }
    const control = keyMap[event.code];
    if (control) {
      setAssist(false);
      controls[control] = true;
      event.preventDefault();
    }
    if (!event.repeat && event.code === "KeyC") changeCamera();
    if (!event.repeat && event.code === "KeyA") setAssist(!assistEnabled);
    if (!event.repeat && event.code === "KeyM") toggleMissionDrawer();
    if (!event.repeat && event.code === "KeyV") toggleReplay();
    if (!event.repeat && event.code === "KeyU") toggleAudio();
    if (!event.repeat && event.code === "KeyZ") toggleStabilityMode();
    if (!event.repeat && event.code === "KeyR") resetFlight();
  });
  window.addEventListener("keyup", (event) => {
    const control = keyMap[event.code];
    if (control) controls[control] = false;
  });
  ui.throttle.addEventListener("input", () => {
    if (flightInputBlocked()) return;
    setAssist(false);
    state.throttle = Number(ui.throttle.value) / 100;
  });
  ui.flightMenuButton.addEventListener("click", toggleFlightMenu);
  ui.closeFlightMenu.addEventListener("click", toggleFlightMenu);
  // Close the mobile panel before dispatching the existing action handlers.
  ui.flightActions.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest("button");
    if (flightMenuOpen && button && button !== ui.closeFlightMenu && !(button as HTMLButtonElement).disabled) closeFlightMenu();
  }, true);
  document.querySelector("#cameraButton")!.addEventListener("click", changeCamera);
  ui.autoButton.addEventListener("click", () => setAssist(!assistEnabled));
  ui.missionButton.addEventListener("click", toggleMissionDrawer);
  ui.closeMissionButton.addEventListener("click", toggleMissionDrawer);
  ui.replayButton.addEventListener("click", toggleReplay);
  ui.audioButton.addEventListener("click", toggleAudio);
  ui.qualityButton.addEventListener("click", toggleQuality);
  ui.stabilityButton.addEventListener("click", toggleStabilityMode);
  document.querySelector("#pauseButton")!.addEventListener("click", () => togglePause());
  document.querySelector("#restartButton")!.addEventListener("click", () => resetFlight());
  ui.modalAction.addEventListener("click", () => {
    if (ui.modalTitle.textContent === "RENDERER PAUSED") return;
    if (replaying || state.phase === "flying") togglePause(false);
    else resetFlight();
  });
  ui.modalReplay.addEventListener("click", toggleReplay);
  ui.replayScrubber.addEventListener("input", () => {
    replayTime = (Number(ui.replayScrubber.value) / 100) * recorder.duration;
    const sample = recorder.sample(replayTime);
    if (sample) applyReplayState(state, sample);
  });
  window.addEventListener("pointerdown", () => void flightAudio.unlock(), { once: true });
  document.querySelectorAll<HTMLButtonElement>("[data-control]").forEach((button) => {
    const name = button.dataset.control as DigitalControl;
    const set = (value: boolean) => {
      if (value && flightInputBlocked()) return;
      if (value) setAssist(false);
      controls[name] = value;
    };
    button.addEventListener("pointerdown", (event) => {
      button.setPointerCapture(event.pointerId);
      set(true);
    });
    button.addEventListener("pointerup", () => set(false));
    button.addEventListener("pointercancel", () => set(false));
    button.addEventListener("lostpointercapture", () => set(false));
  });
  window.addEventListener("blur", clearFlightControls);
  window.setTimeout(() => document.querySelector("#hint")?.classList.add("hidden-hint"), 7000);
}

function renderMissionList() {
  ui.missionList.innerHTML = "";
  MISSIONS.forEach((mission, index) => {
    const previous = index > 0 ? MISSIONS[index - 1] : undefined;
    const unlocked = !previous || (records.bestScores[previous.id] ?? 0) >= mission.unlockScore;
    const button = document.createElement("button");
    button.className = `mission-card${mission.id === currentMission.id ? " active" : ""}${unlocked ? "" : " locked"}`;
    button.style.setProperty("--mission-accent", mission.accent);
    const best = records.bestScores[mission.id] ?? 0;
    button.innerHTML = `<span class="number">${mission.number}</span><span><strong>${mission.title}</strong><p>${mission.description}</p><em>${
      best ? `PERSONAL BEST ${best}` : unlocked ? "READY TO FLY" : `REQUIRES ${mission.unlockScore} ON ${previous?.title.toUpperCase()}`
    }</em></span><small>${mission.difficulty}</small>`;
    button.disabled = !unlocked;
    button.addEventListener("click", () => selectMission(mission));
    ui.missionList.appendChild(button);
  });
}

function selectMission(mission: MissionDefinition) {
  currentMission = mission;
  drawerOpen = false;
  ui.missionDrawer.classList.add("hidden");
  resetFlight();
  applyMissionPresentation();
  renderMissionList();
}

function applyMissionPresentation() {
  ui.missionNumber.textContent = `MISSION ${currentMission.number}`;
  const [first, ...rest] = currentMission.title.toUpperCase().split(" ");
  ui.missionTitle.innerHTML = `${first} <em>${rest.join(" ")}</em>`;
  const night = currentMission.id === "night";
  scene.fog = new THREE.FogExp2(night ? 0x06111d : 0x839194, night ? 0.017 : 0.011);
  scene.background = new THREE.Color(night ? 0x06111d : 0x819093);
  const skyMaterial = (sky as THREE.Mesh).material as THREE.ShaderMaterial;
  skyMaterial.uniforms.topColor.value.setHex(night ? 0x051024 : 0x315c70);
  skyMaterial.uniforms.horizonColor.value.setHex(night ? 0x142b42 : 0xb3c3c1);
  skyMaterial.uniforms.bottomColor.value.setHex(night ? 0x02070e : 0x536e72);
  skyMaterial.uniforms.uNight.value = night ? 1 : 0;
  sun.intensity = night ? 0.45 : 3.4;

  const oceanMat = ocean.material as THREE.ShaderMaterial;
  oceanMat.uniforms.uNight.value = night ? 1 : 0;
  oceanMat.uniforms.uDeep.value.setHex(night ? 0x02080e : 0x04131b);
  oceanMat.uniforms.uTop.value.setHex(night ? 0x061822 : 0x15434d);

  shipData.spotlights.forEach((spot) => {
    spot.intensity = night ? 70 : 25;
  });

  // Dynamic PMREM update for night reflections
  try {
    const envScene = new THREE.Scene();
    const envSky = createSky();
    (envSky.material as THREE.ShaderMaterial).uniforms.uNight.value = night ? 1 : 0;
    envScene.add(envSky);
    const envTexture = pmremGenerator.fromScene(envScene).texture;
    scene.environment = envTexture;
  } catch {}
}

function interactionBlocked() {
  return paused || drawerOpen || flightMenuOpen || !ui.modal.classList.contains("hidden");
}

function flightInputBlocked() {
  return interactionBlocked() || replaying;
}

function clearFlightControls() {
  controls.forward = controls.back = controls.left = controls.right = controls.throttleUp = controls.throttleDown = false;
  controls.pitchAxis = controls.rollAxis = controls.throttleAxis = undefined;
  controls.assistTiltX = controls.assistTiltZ = controls.assistThrottle = undefined;
}

function toggleFlightMenu() {
  if (flightMenuOpen) { closeFlightMenu(); return; }
  pausedBeforePanel = paused;
  flightMenuOpen = true;
  setPaused(true);
  ui.pauseButton.querySelector("span")!.textContent = pausedBeforePanel ? "RESUME" : "PAUSE";
  ui.flightActions.classList.add("menu-open");
  ui.flightActions.setAttribute("role", "dialog");
  ui.flightActions.setAttribute("aria-modal", "true");
  ui.flightMenuButton.setAttribute("aria-expanded", "true");
  overlay.set(ui.flightActions);
}

function closeFlightMenu() {
  flightMenuOpen = false;
  ui.flightActions.classList.remove("menu-open");
  ui.flightActions.removeAttribute("role");
  ui.flightActions.removeAttribute("aria-modal");
  ui.flightMenuButton.setAttribute("aria-expanded", "false");
  setPaused(pausedBeforePanel);
  overlay.set(null);
  if (state.phase !== "flying" && !replaying) showEndState();
}

function toggleMissionDrawer() {
  drawerOpen = !drawerOpen;
  ui.missionDrawer.classList.toggle("hidden", !drawerOpen);
  if (drawerOpen) {
    pausedBeforePanel = paused;
    setPaused(true);
    hideModal();
    overlay.set(ui.missionDrawer);
  } else {
    setPaused(pausedBeforePanel);
    overlay.set(null);
    if (state.phase !== "flying" && !replaying) showEndState();
  }
}

function toggleReplay() {
  if (!recorder.hasReplay) return;
  if (replaying) {
    replaying = false;
    ui.replayTimeline.classList.add("hidden");
    ui.replayButton.classList.remove("active");
    resetFlight(false);
    return;
  }
  replaying = true;
  replayTime = 0;
  paused = false;
  endShown = true;
  setAssist(false);
  hideModal();
  ui.replayTimeline.classList.remove("hidden");
  ui.replayButton.classList.add("active");
  ui.replayButton.querySelector("span")!.textContent = "EXIT REPLAY";
  const sample = recorder.sample(0);
  if (sample) applyReplayState(state, sample);
}

function toggleAudio() {
  records.audioEnabled = !records.audioEnabled;
  flightAudio.setEnabled(records.audioEnabled);
  saveRecords(records);
  ui.audioButton.classList.toggle("active", records.audioEnabled);
  const label = ui.audioButton.querySelector("span");
  if (label) label.textContent = records.audioEnabled ? "AUDIO" : "MUTED";
  if (records.audioEnabled) void flightAudio.unlock();
}

function toggleQuality() {
  records.quality = records.quality === "high" ? "low" : "high";
  saveRecords(records);
  applyQuality();
}

function applyQuality() {
  const high = records.quality === "high";
  renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 2 : 1));
  renderer.shadowMap.enabled = high;
  bloom.enabled = high;
  ui.qualityButton.textContent = `GRAPHICS: ${records.quality.toUpperCase()}`;
  ui.audioButton.classList.toggle("active", records.audioEnabled);
  resize();
}

function changeCamera() {
  cameraMode = (cameraMode + 1) % CAMERA_NAMES.length;
  ui.cameraButton.classList.toggle("active", cameraMode === 2);
  const label = ui.cameraButton.querySelector("span");
  if (label) label.textContent = CAMERA_NAMES[cameraMode];
  if (cameraMode === 2) {
    camera.position.set(31, 20, 38);
    orbit.target.set(0, 8, 0);
    orbit.update();
  }
}

function setAssist(value: boolean) {
  assistEnabled = value && state.phase === "flying";
  ui.autoButton.classList.toggle("active", assistEnabled);
  ui.autoButton.setAttribute("aria-pressed", String(assistEnabled));
  controls.assistTiltX = controls.assistTiltZ = controls.assistThrottle = undefined;
  controls.rateMode = assistEnabled ? false : rateMode;
}

function toggleStabilityMode() {
  rateMode = !rateMode;
  controls.rateMode = rateMode && !assistEnabled;
  ui.stabilityButton.textContent = `CONTROL: ${rateMode ? "DIRECT RATE" : "ATTITUDE HOLD"}`;
}

function togglePause(force?: boolean) {
  if (state.phase !== "flying" && !replaying) return;
  setPaused(force ?? !paused);
  if (paused) showModal("FLIGHT PAUSED", "Simulation time is frozen. Your landing solution is preserved.", "RESUME FLIGHT", `MISSION ${currentMission.number}`);
  else hideModal();
}

function setPaused(value: boolean) {
  paused = value;
  if (value) clearFlightControls();
  accumulator = 0;
  const label = ui.pauseButton.querySelector("span");
  if (label) label.textContent = value ? "RESUME" : "PAUSE";
  orbit.enabled = cameraMode === 2 && !interactionBlocked();
}

function resetFlight(clearReplay = true) {
  clearTimeout(endTimer);
  clearFlightControls();
  drawerOpen = false;
  ui.missionDrawer.classList.add("hidden");
  state = createFlightState(currentMission.init);
  setPaused(false);
  endShown = false;
  accumulator = 0;
  replaying = false;
  replayTime = 0;
  setAssist(false);
  hideModal();
  ui.replayTimeline.classList.add("hidden");
  ui.replayButton.classList.remove("active");
  ui.replayButton.querySelector("span")!.textContent = "REPLAY";
  if (clearReplay) {
    recorder.reset();
    ui.replayButton.disabled = true;
  }
}

function showEndState() {
  const feedback = getLandingDebrief(state);
  const landed = state.phase === "landed";
  showModal(
    landed ? "TOUCHDOWN" : "VEHICLE LOST",
    landed ? `Odyssey secured. Score ${state.touchdownScore}. ${feedback.summary}` : feedback.failureReasons.join(" "),
    landed ? "FLY AGAIN" : "RETRY APPROACH",
    landed ? "MISSION COMPLETE" : "MISSION FAILED"
  );
  renderLandingDebrief(text("landingDebrief"), feedback);
  ui.modalReplay.classList.toggle("hidden", !recorder.hasReplay);
}

function showModal(title: string, copy: string, action: string, eyebrow: string) {
  clearFlightControls();
  text("landingDebrief").hidden = true;
  ui.modalTitle.textContent = title;
  ui.modalCopy.textContent = copy;
  ui.modalAction.textContent = action;
  ui.modalEyebrow.textContent = eyebrow;
  ui.modalReplay.classList.add("hidden");
  ui.modal.classList.remove("hidden");
  overlay.set(ui.modal);
}

function hideModal() {
  ui.modal.classList.add("hidden");
  overlay.set(null);
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60),
    secs = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${secs.toFixed(1).padStart(4, "0")}`;
}

function resize() {
  if (innerWidth > 720 && flightMenuOpen) closeFlightMenu();
  const w = innerWidth,
    h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (cameraMode === 0 && camera.aspect < 1) {
    const framing = portraitChaseFrame(state.position, camera.aspect, camera.fov);
    camera.position.copy(framing.desired);
    camera.lookAt(framing.target);
  }
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
}

function text(id: string) {
  return document.querySelector<HTMLElement>(`#${id}`)!;
}
