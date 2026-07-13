import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import "./style.css";
import { createFlightState, deckHeightAt, deckPose, ROCKET_HALF_HEIGHT, stepFlight, type Controls } from "./simulation";
import { MISSIONS, missionById, type MissionDefinition } from "./game/missions";
import { FlightAudio } from "./game/audio";
import { updateLandingAssist } from "./game/autopilot";
import { pollGamepad, pulseGamepad } from "./game/input";
import { loadRecords, recordLanding, saveRecords } from "./game/persistence";
import { applyReplayState, ReplayRecorder } from "./game/replay";
import { trackingCameraPose, type CameraMode } from "./render/cameraRig";
import { createDebrief, medalForScore } from "./game/debrief";
import { EnvironmentEffects } from "./render/environmentEffects";

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
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = .055;
orbit.enablePan = false;
orbit.minDistance = 10;
orbit.maxDistance = 80;
orbit.maxPolarAngle = Math.PI * .48;
orbit.enabled = false;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .28, .5, .88);
composer.addPass(bloom);

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
const sky = createSky();
const ocean = createOcean();
const ship = createShip();
const rocket = createRocket();
const landingMarker = createLandingMarker();
const clouds = createClouds();
const exhaust = createExhaustTrail();
const impactEffect = createImpactEffect();
const environmentEffects = new EnvironmentEffects();
const ghostRocket = createGhostRocket(rocket);
const replayPath = createReplayPath();
world.add(sky, ocean, ship, rocket, ghostRocket, landingMarker, clouds, exhaust.points, impactEffect.group, environmentEffects.group, replayPath);

let currentMission = MISSIONS[0];
let state = createFlightState(currentMission.init);
const controls: Controls = { forward: false, back: false, left: false, right: false, throttleUp: false, throttleDown: false };
const recorder = new ReplayRecorder();
const bestRecorder = new ReplayRecorder();
const flightAudio = new FlightAudio();
const records = loadRecords();
const systemReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
flightAudio.setEnabled(records.audioEnabled);
let paused = false;
let cameraMode: CameraMode = 0;
let accumulator = 0;
let previousTime = performance.now();
let endShown = false;
let assistEnabled = false;
let replaying = false;
let replayTime = 0;
let drawerOpen = false;
let rateMode = false;
let compareEnabled = true;
let comparisonFrames = records.bestReplays[currentMission.id] ?? [];
let lastFlightScore = 0;
let cameraInitialized = false;
const fixedDt = 1 / 120;
const simulationRate = import.meta.env.DEV ? Math.max(1,Math.min(6,Number(new URLSearchParams(location.search).get("simSpeed"))||1)) : 1;

const ui = {
  altitude: text("altitude"), velocity: text("velocity"), fuel: text("fuel"), drift: text("drift"),
  status: text("statusText"), throttleValue: text("throttleValue"), callout: text("callout"),
  throttle: document.querySelector<HTMLInputElement>("#throttle")!, modal: document.querySelector<HTMLElement>("#modal")!,
  modalEyebrow: text("modalEyebrow"), modalTitle: text("modalTitle"), modalCopy: text("modalCopy"),
  modalAction: document.querySelector<HTMLButtonElement>("#modalAction")!, pauseButton: document.querySelector<HTMLButtonElement>("#pauseButton")!,
  modalReplay: document.querySelector<HTMLButtonElement>("#modalReplay")!,
  autoButton: document.querySelector<HTMLButtonElement>("#autoButton")!, cameraButton: document.querySelector<HTMLButtonElement>("#cameraButton")!,
  missionButton: document.querySelector<HTMLButtonElement>("#missionButton")!, replayButton: document.querySelector<HTMLButtonElement>("#replayButton")!,
  audioButton: document.querySelector<HTMLButtonElement>("#audioButton")!, missionDrawer: document.querySelector<HTMLElement>("#missionDrawer")!,
  missionList: text("missionList"), missionNumber: text("missionNumber"), missionTitle: text("missionTitle"),
  closeMissionButton: document.querySelector<HTMLButtonElement>("#closeMissionButton")!, qualityButton: document.querySelector<HTMLButtonElement>("#qualityButton")!,
  stabilityButton: document.querySelector<HTMLButtonElement>("#stabilityButton")!,
  gamepadStatus: text("gamepadStatus"), windValue: text("windValue"), windArrow: text("windArrow"), swellValue: text("swellValue"),
  weatherValue:text("weatherValue"),
  replayTimeline: text("replayTimeline"), replayScrubber: document.querySelector<HTMLInputElement>("#replayScrubber")!, replayTime: text("replayTime"),
  flightCue: text("flightCue"), compareButton: document.querySelector<HTMLButtonElement>("#compareButton")!, missionObjectives:text("missionObjectives"),
  comfortButton:document.querySelector<HTMLButtonElement>("#comfortButton")!,deadzoneButton:document.querySelector<HTMLButtonElement>("#deadzoneButton")!,trainingButton:document.querySelector<HTMLButtonElement>("#trainingButton")!,
  drawerAudioButton:document.querySelector<HTMLButtonElement>("#drawerAudioButton")!,
  debrief:text("debrief"),debriefMedal:text("debriefMedal"),debriefMetrics:text("debriefMetrics"),debriefObjectives:text("debriefObjectives"),
};

applyMissionPresentation();
renderMissionList();
applyQuality();
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
  const pad = pollGamepad(controls,records.gamepadDeadzone);
  ui.gamepadStatus.textContent = pad.connected ? "GAMEPAD: CONNECTED" : "GAMEPAD: NOT DETECTED";
  if (replaying && !paused) {
    replayTime = Math.min(recorder.duration, replayTime + elapsed);
    const sample = recorder.sample(replayTime); if (sample) applyReplayState(state, sample);
    if (replayTime >= recorder.duration) paused = true;
  } else if (!paused) {
    accumulator += elapsed*simulationRate;
    while (accumulator >= fixedDt) {
      applyLandingAssist();
      stepFlight(state, controls, fixedDt);
      recorder.record(state);
      accumulator -= fixedDt;
    }
  }
  updateWorld(now / 1000, elapsed);
  updateUi();
  const altitude=Math.max(0,state.position.y-ROCKET_HALF_HEIGHT-deckHeightAt(state.position.x,state.position.z,state.time,state.seaState));
  flightAudio.update(state.throttle, Math.hypot(state.velocity.x,state.velocity.y,state.velocity.z),state.stress,state.phase,altitude);
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
  const flameScale = state.phase === "flying" && state.fuel > 0 ? state.throttle * (0.85 + Math.sin(visualTime * 48) * 0.1) : 0;
  flame.scale.set(1, flameScale, 1);
  flame.visible = flameScale > 0.02;
  (flame.userData.light as THREE.PointLight).intensity = flameScale * 18;
  flame.rotation.x = state.gimbal.x * .8;
  flame.rotation.z = state.gimbal.z * .8;
  updateExhaustTrail(exhaust, visualTime, dt, flameScale);
  updateImpactEffect(impactEffect,dt);
  environmentEffects.update(visualTime,dt,state.position,state.seaState,records.cameraComfort||systemReducedMotion.matches);
  const feet=rocket.userData.feet as THREE.Mesh[];
  feet.forEach((foot,index)=>foot.position.y=-2.82+(state.legCompression[index]??0)*.12);
  clouds.children.forEach((cloud, index) => {
    cloud.position.x += dt * (.32 + index % 3 * .07);
    if (cloud.position.x > 110) cloud.position.x = -110;
  });

  const water = ocean.material as THREE.ShaderMaterial;
  water.uniforms.uTime.value = visualTime;

  if(replaying&&compareEnabled&&bestRecorder.hasReplay){
    const comparison=bestRecorder.sample(Math.min(replayTime,bestRecorder.duration));
    if(comparison){ ghostRocket.visible=true; ghostRocket.position.set(comparison.position.x,comparison.position.y,comparison.position.z); ghostRocket.rotation.set(comparison.tiltX,0,comparison.tiltZ); }
  } else ghostRocket.visible=false;

  const desired = new THREE.Vector3();
  const target = new THREE.Vector3();
  orbit.enabled = cameraMode === 2 && !paused;
  if (cameraMode === 2) {
    orbit.target.lerp(new THREE.Vector3(state.position.x * .3, Math.max(3, state.position.y * .35), state.position.z * .2), 1 - Math.exp(-dt * 2));
    orbit.update();
  } else {
    const pose = trackingCameraPose(cameraMode, state.position, camera.aspect);
    desired.set(pose.position.x, pose.position.y, pose.position.z);
    target.set(pose.target.x, pose.target.y, pose.target.z);
  }
  if (cameraMode !== 2) {
    const ease = 1 - Math.exp(-dt * (records.cameraComfort?4.6:2.8));
    camera.position.lerp(desired, ease);
    camera.lookAt(target);
  }

  if (state.phase !== "flying" && !endShown) {
    endShown = true;
    pulseGamepad(state.phase==="landed"?.38:1,state.phase==="landed"?180:650);
    triggerImpactEffect(impactEffect,state.phase==="crashed");
    ui.replayButton.disabled = !recorder.hasReplay;
    lastFlightScore=state.touchdownScore;
    comparisonFrames=structuredClone(records.bestReplays[state.missionId]??[]);
    if(state.phase==="landed") {
      const isBest=recordLanding(records,state.missionId,state.touchdownScore);
      if(isBest){records.bestReplays[state.missionId]=recorder.export();saveRecords(records);}
      renderMissionList();
    }
    window.setTimeout(showEndState, 500);
  }
}

function createSky() {
  const geometry = new THREE.SphereGeometry(230, 36, 18);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x315c70) },
      horizonColor: { value: new THREE.Color(0xb3c3c1) },
      bottomColor: { value: new THREE.Color(0x536e72) },
      sunDirection: { value: new THREE.Vector3(-.48, .66, -.25).normalize() },
    },
    vertexShader: `varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.); vWorld=normalize(w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor; uniform vec3 sunDirection; varying vec3 vWorld;
      void main(){ float h=clamp(vWorld.y*.5+.5,0.,1.); vec3 col=mix(bottomColor,horizonColor,smoothstep(.35,.52,h)); col=mix(col,topColor,smoothstep(.52,.9,h)); float sun=pow(max(dot(vWorld,sunDirection),0.),420.); float haze=pow(max(dot(vWorld,sunDirection),0.),12.); col+=vec3(1.,.65,.35)*sun*4.+vec3(1.,.46,.2)*haze*.22; gl_FragColor=vec4(col,1.); }`,
  });
  return new THREE.Mesh(geometry, material);
}

function makeCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 128);
  const blobs = [[60,76,45],[105,55,56],[150,68,48],[190,78,36]];
  for (const [x,y,r] of blobs) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(235,242,239,.52)");
    gradient.addColorStop(.52, "rgba(220,231,230,.24)");
    gradient.addColorStop(1, "rgba(210,222,222,0)");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createClouds() {
  const group = new THREE.Group();
  const texture = makeCloudTexture();
  const positions = [[-72,40,-80],[18,33,-105],[72,46,-62],[-90,30,8],[88,37,16],[-28,55,-120],[48,28,82]];
  positions.forEach(([x,y,z], i) => {
    const material = new THREE.SpriteMaterial({ map:texture, transparent:true, opacity:.48 + (i%3)*.08, depthWrite:false, fog:true });
    const sprite = new THREE.Sprite(material); sprite.position.set(x,y,z); sprite.scale.set(46 + i%2*18,20 + i%2*7,1); group.add(sprite);
  });
  return group;
}

interface ExhaustTrail {
  points: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  particles: Array<{ life:number; velocity:THREE.Vector3 }>;
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
  const material = new THREE.PointsMaterial({ size:1.25, map:texture, transparent:true, opacity:.52, vertexColors:true, depthWrite:false, blending:THREE.NormalBlending, sizeAttenuation:true });
  const points = new THREE.Points(geometry, material);
  const particles = Array.from({ length:count }, () => ({ life:0, velocity:new THREE.Vector3() }));
  return { points, positions, colors, particles, cursor:0, spawnCarry:0 };
}

function makeParticleTexture() {
  const canvas = document.createElement("canvas"); canvas.width=64; canvas.height=64;
  const ctx=canvas.getContext("2d")!; const gradient=ctx.createRadialGradient(32,32,1,32,32,31);
  gradient.addColorStop(0,"rgba(255,255,255,1)"); gradient.addColorStop(.22,"rgba(255,210,140,.7)"); gradient.addColorStop(1,"rgba(80,95,95,0)");
  ctx.fillStyle=gradient; ctx.fillRect(0,0,64,64); return new THREE.CanvasTexture(canvas);
}

function updateExhaustTrail(trail: ExhaustTrail, time: number, dt: number, power: number) {
  if (!paused && power > .08) {
    trail.spawnCarry += dt * (16 + power * 42);
    while (trail.spawnCarry >= 1) {
      trail.spawnCarry--;
      const i=trail.cursor++ % trail.particles.length; const p=trail.particles[i];
      p.life=1.4 + Math.random()*.8;
      p.velocity.set((Math.random()-.5)*.75-state.velocity.x*.08,-3.8-power*3+Math.random(),(Math.random()-.5)*.75-state.velocity.z*.08);
      trail.positions[i*3]=state.position.x+(Math.random()-.5)*.28;
      trail.positions[i*3+1]=state.position.y-3.1;
      trail.positions[i*3+2]=state.position.z+(Math.random()-.5)*.28;
    }
  }
  trail.particles.forEach((p,i) => {
    if (p.life<=0) return;
    p.life-=dt; p.velocity.y+=dt*1.8;
    trail.positions[i*3]+=p.velocity.x*dt; trail.positions[i*3+1]+=p.velocity.y*dt; trail.positions[i*3+2]+=p.velocity.z*dt;
    const heat=Math.max(0,Math.min(1,p.life/.55));
    trail.colors[i*3]=.42+heat*.58; trail.colors[i*3+1]=.48+heat*.33; trail.colors[i*3+2]=.5+heat*.12;
    if (p.life<=0) trail.positions[i*3]=trail.positions[i*3+1]=trail.positions[i*3+2]=999;
  });
  (trail.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;
  (trail.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate=true;
  trail.points.rotation.y=Math.sin(time*.08)*.001;
}

interface ImpactEffect {
  group:THREE.Group; sparks:THREE.Points; ring:THREE.Mesh; light:THREE.PointLight;
  positions:Float32Array; velocities:THREE.Vector3[]; life:number; violent:boolean;
}

function createImpactEffect():ImpactEffect {
  const group=new THREE.Group(),count=72,positions=new Float32Array(count*3),velocities=Array.from({length:count},()=>new THREE.Vector3());
  positions.fill(999); const geometry=new THREE.BufferGeometry(); geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  const sparks=new THREE.Points(geometry,new THREE.PointsMaterial({size:.18,color:0xff7b32,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));
  const ring=new THREE.Mesh(new THREE.RingGeometry(.7,.82,48),new THREE.MeshBasicMaterial({color:0xff8a42,transparent:true,opacity:0,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false})); ring.rotation.x=-Math.PI/2;
  const light=new THREE.PointLight(0xff6328,0,24,2); group.add(sparks,ring,light); group.visible=false;
  return {group,sparks,ring,light,positions,velocities,life:0,violent:false};
}

function triggerImpactEffect(effect:ImpactEffect,violent:boolean){
  effect.group.visible=true; effect.group.position.set(state.position.x,deckHeightAt(state.position.x,state.position.z,state.time,state.seaState)+.15,state.position.z);
  effect.life=violent?1.3:.55; effect.violent=violent; effect.ring.scale.setScalar(1);
  effect.velocities.forEach((velocity,i)=>{ const a=Math.random()*Math.PI*2,speed=(violent?4.5:1.8)*(0.35+Math.random()); velocity.set(Math.cos(a)*speed,Math.random()*(violent?5:1.5),Math.sin(a)*speed); effect.positions[i*3]=effect.positions[i*3+1]=effect.positions[i*3+2]=0; });
  ((effect.sparks.material)as THREE.PointsMaterial).opacity=violent?.92:.38; effect.light.intensity=violent?55:12;
}

function updateImpactEffect(effect:ImpactEffect,dt:number){
  if(effect.life<=0)return; effect.life-=dt;
  effect.velocities.forEach((velocity,i)=>{velocity.y-=9.81*dt; effect.positions[i*3]+=velocity.x*dt; effect.positions[i*3+1]+=velocity.y*dt; effect.positions[i*3+2]+=velocity.z*dt;});
  (effect.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate=true;
  const fade=Math.max(0,effect.life/(effect.violent?1.3:.55)); ((effect.sparks.material)as THREE.PointsMaterial).opacity=fade*(effect.violent?.92:.38);
  effect.ring.scale.addScalar(dt*(effect.violent?7:3)); ((effect.ring.material)as THREE.MeshBasicMaterial).opacity=fade*(effect.violent?.55:.18); effect.light.intensity=fade*(effect.violent?55:12);
  if(effect.life<=0)effect.group.visible=false;
}

function createOcean() {
  const geometry = new THREE.PlaneGeometry(500, 500, 80, 80);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSeaState:{value:1},uRain:{value:0}, uDeep: { value: new THREE.Color(0x071b22) }, uTop: { value: new THREE.Color(0x1d525b) } },
    vertexShader: `uniform float uTime; uniform float uSeaState; varying float vWave; varying vec3 vWorld;
      void main(){ vec3 p=position; float scale=.7+uSeaState*.28; float a=sin(p.x*.105+uTime*.72)*.26; float b=sin(p.y*.078-uTime*.61)*.2; float c=sin((p.x+p.y)*.041+uTime*.37)*.33; float d=sin(length(p.xy)*.15-uTime*.92)*.07; p.z=(a+b+c+d)*scale; vWave=p.z; vec4 w=modelMatrix*vec4(p,1.); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uDeep; uniform vec3 uTop; uniform float uRain; uniform float uTime; varying float vWave; varying vec3 vWorld;
      void main(){ vec3 dx=dFdx(vWorld),dy=dFdy(vWorld); vec3 n=normalize(cross(dx,dy)); if(n.y<0.)n=-n; vec3 viewDir=normalize(cameraPosition-vWorld); float fres=pow(1.-max(dot(n,viewDir),0.),3.); vec3 sunDir=normalize(vec3(-.45,.72,-.3)); float glint=pow(max(dot(reflect(-sunDir,n),viewDir),0.),90.); float crest=smoothstep(.34,.58,vWave); float rain=sin(vWorld.x*4.1+uTime*7.)*sin(vWorld.z*3.7-uTime*8.)*.5+.5; vec3 col=mix(uDeep,uTop,clamp(vWave+.5,0.,1.)); col+=fres*vec3(.18,.4,.45)+glint*vec3(1.,.72,.42)*1.55+crest*vec3(.18,.3,.29)+rain*uRain*.025; gl_FragColor=vec4(col,1.); }`,
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
  const hull = new THREE.Mesh(createHullGeometry(), hullMat);
  hull.castShadow = hull.receiveShadow = true; group.add(hull);
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
  const orange = new THREE.MeshStandardMaterial({ color:0xf15b2a, roughness:.72, metalness:.18 });
  const equipmentMat = new THREE.MeshStandardMaterial({ color:0xe4e7df, roughness:.58, metalness:.32 });
  for (const x of [-4.9,-3.1]) for (const z of [7.6,10.1,12.6]) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(.48,1.25,5,12),equipmentMat);
    tank.position.set(x,1.2,z); tank.castShadow=true; group.add(tank);
  }
  for (const x of [-6.95,6.95]) {
    const rail = new THREE.Group();
    for (let z=-14;z<=14;z+=2) {
      const post=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.7,5),white); post.position.set(x,.7,z); rail.add(post);
    }
    for (const y of [.55,.88]) { const bar=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,28,5),white); bar.rotation.x=Math.PI/2; bar.position.set(x,y,0); rail.add(bar); }
    group.add(rail);
  }
  const radarBase=new THREE.Mesh(new THREE.CylinderGeometry(.55,.72,.5,16),hullMat); radarBase.position.set(4.6,6.1,11); group.add(radarBase);
  const radar=new THREE.Mesh(new THREE.SphereGeometry(.62,16,10,0,Math.PI*2,0,Math.PI*.52),equipmentMat); radar.position.set(4.6,6.35,11); group.add(radar);
  const deckStripeMat=new THREE.MeshBasicMaterial({color:0xf15b2a,side:THREE.DoubleSide});
  for (const x of [-5.7,5.7]) { const stripe=new THREE.Mesh(new THREE.PlaneGeometry(.08,25),deckStripeMat); stripe.rotation.x=-Math.PI/2; stripe.position.set(x,.245,-1.2); group.add(stripe); }
  const nameTexture=makeDeckLabel();
  const label=new THREE.Mesh(new THREE.PlaneGeometry(4.4,1.15),new THREE.MeshBasicMaterial({map:nameTexture,transparent:true,side:THREE.DoubleSide}));
  label.rotation.x=-Math.PI/2; label.position.set(0,.255,-11.7); group.add(label);
  const hazard=new THREE.Mesh(new THREE.RingGeometry(4.15,4.42,64),new THREE.MeshBasicMaterial({color:0xf15b2a,side:THREE.DoubleSide,transparent:true,opacity:.92}));
  hazard.rotation.x=-Math.PI/2; hazard.position.y=.26; group.add(hazard);
  for (const x of [-5.8,5.8]) for (const z of [-14.2,14.2]) {
    const bumper=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,1.4,10),orange); bumper.rotation.z=Math.PI/2; bumper.position.set(x,.1,z); group.add(bumper);
  }
  return group;
}

function createHullGeometry(){
  const outline=[[-7.5,17],[7.5,17],[7.5,-13],[0,-21],[-7.5,-13]];
  const positions:number[]=[];
  outline.forEach(([x,z])=>positions.push(x,0,z));
  outline.forEach(([x,z])=>positions.push(x*.84,-3.9,z+.35));
  const indices:number[]=[];
  indices.push(0,1,2,0,2,3,0,3,4);
  indices.push(5,7,6,5,8,7,5,9,8);
  for(let i=0;i<5;i++){const n=(i+1)%5;indices.push(i,n,5+n,i,5+n,5+i);}
  const geometry=new THREE.BufferGeometry(); geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function makeDeckLabel() {
  const canvas=document.createElement("canvas"); canvas.width=512; canvas.height=128;
  const ctx=canvas.getContext("2d")!; ctx.clearRect(0,0,512,128); ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.font="700 58px Arial"; ctx.fillStyle="#dce3dd"; ctx.fillText("ODYSSEY",256,52);
  ctx.font="500 22px Arial"; ctx.fillStyle="#f15b2a"; ctx.fillText("AUTONOMOUS SPACEPORT  •  04",256,99);
  const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace; texture.anisotropy=renderer.capabilities.getMaxAnisotropy(); return texture;
}

function createLandingMarker() {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xf3eee5, transparent: true, opacity: .88, side: THREE.DoubleSide });
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
  const feet:THREE.Mesh[]=[];
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9ddd7, roughness: .48, metalness: .64 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x171c1c, roughness: .62, metalness: .4 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.75, .88, 4.3, 24), bodyMat); body.position.y = .25; body.castShadow = true; group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.75, 1.4, 24), bodyMat); nose.position.y = 3.1; nose.castShadow = true; group.add(nose);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.77, .77, .48, 24), darkMat); band.position.y = 1.45; group.add(band);
  const accentMat = new THREE.MeshStandardMaterial({ color:0xf15b2a,roughness:.55,metalness:.42 });
  const accent = new THREE.Mesh(new THREE.CylinderGeometry(.79,.79,.12,24),accentMat); accent.position.y=.92; group.add(accent);
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(.43, .62, .65, 16), darkMat); engine.position.y = -2.18; group.add(engine);
  for (let i=0;i<4;i++) {
    const a=i*Math.PI/2;
    const fin=new THREE.Mesh(new THREE.BoxGeometry(.06,.72,.68),darkMat);
    fin.position.set(Math.sin(a)*.93,1.73,Math.cos(a)*.93); fin.rotation.y=a; fin.castShadow=true; group.add(fin);
  }
  for (let i=0;i<6;i++) {
    const nozzle=new THREE.Mesh(new THREE.CylinderGeometry(.055,.075,.14,8),darkMat);
    const a=i*Math.PI/3; nozzle.rotation.z=Math.PI/2; nozzle.position.set(Math.cos(a)*.78,2.25+Math.sin(a)*.22,Math.sin(a)*.78); group.add(nozzle);
  }
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.11, 2.25, .14), darkMat);
    leg.position.set(Math.sin(a) * .78, -1.75, Math.cos(a) * .78); leg.rotation.z = Math.sin(a) * -.32; leg.rotation.x = Math.cos(a) * .32; group.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.48, .09, .48), darkMat); foot.position.set(Math.sin(a) * 1.15, -2.82, Math.cos(a) * 1.15); group.add(foot); feet.push(foot);
  }
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(.5, 3.5, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: .62, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  outer.rotation.x = Math.PI; outer.position.y = -4.1; flame.add(outer);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(.25, 2.2, 14), new THREE.MeshBasicMaterial({ color: 0xfff0b1, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  inner.rotation.x = Math.PI; inner.position.y = -3.6; flame.add(inner);
  const engineLight = new THREE.PointLight(0xff6a28, 0, 11, 2); engineLight.position.y=-3.05; flame.add(engineLight); flame.userData.light=engineLight;
  group.add(flame); group.userData.flame = flame; group.userData.feet=feet;
  return group;
}

function createGhostRocket(source:THREE.Group){
  const ghost=source.clone(true);
  ghost.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    const material=(object.material as THREE.Material).clone();
    material.transparent=true; material.opacity=.18; material.depthWrite=false;
    if("color" in material)(material as THREE.MeshBasicMaterial).color.setHex(0x79e6ff);
    object.material=material;
  });
  ghost.visible=false; ghost.renderOrder=3; return ghost;
}

function createReplayPath(){
  const line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x71dff2,transparent:true,opacity:.42,depthWrite:false}));
  line.visible=false; return line;
}

function updateReplayPath(){
  replayPath.geometry.dispose();
  replayPath.geometry=new THREE.BufferGeometry().setFromPoints(recorder.path.map(point=>new THREE.Vector3(point.x,point.y,point.z)));
  replayPath.visible=replaying&&recorder.hasReplay;
}

function updateUi() {
  const deckY = deckHeightAt(state.position.x, state.position.z, state.time, state.seaState);
  const altitude = Math.max(0, state.position.y - ROCKET_HALF_HEIGHT - deckY);
  const drift = Math.hypot(state.velocity.x, state.velocity.z);
  ui.altitude.textContent = altitude.toFixed(1).padStart(4, "0");
  ui.velocity.textContent = Math.abs(state.velocity.y).toFixed(1);
  ui.velocity.style.color = Math.abs(state.velocity.y) > 3.1 && altitude < 10 ? "#ff5a1f" : "";
  ui.fuel.textContent = Math.round(state.fuel * 100).toString();
  ui.drift.textContent = drift.toFixed(1);
  const windSpeed=Math.hypot(state.wind.currentX,state.wind.currentZ);
  ui.windValue.textContent=windSpeed.toFixed(1);
  ui.windArrow.style.rotate=`${Math.atan2(state.wind.currentX,-state.wind.currentZ)*180/Math.PI}deg`;
  ui.swellValue.textContent=state.seaState.toFixed(1);
  const percent = Math.round(state.throttle * 100);
  ui.throttle.value = percent.toString(); ui.throttleValue.textContent = `${percent}%`;
  ui.throttle.style.setProperty("--fill", `${percent}%`);
  const targetDistance = Math.hypot(state.position.x, state.position.z);
  ui.callout.innerHTML = targetDistance < 5 ? "DECK LOCKED <b>●</b>" : "ALIGN WITH TARGET <b>◆</b>";
  const tilt=Math.max(Math.abs(state.tiltX),Math.abs(state.tiltZ));
  const vertical=Math.abs(state.velocity.y);
  let cue="NOMINAL",severity:"nominal"|"caution"|"danger"="nominal";
  if(state.fuel<.08){cue="FUEL CRITICAL";severity="danger";}
  else if(altitude<12&&vertical>3.1){cue="SLOW DESCENT";severity="danger";}
  else if(altitude<12&&drift>2.1){cue="ARREST DRIFT";severity="danger";}
  else if(altitude<12&&tilt>.14){cue="LEVEL VEHICLE";severity="danger";}
  else if(state.fuel<.18){cue="LOW RESERVE";severity="caution";}
  else if(altitude<18&&(vertical>2.5||drift>1.5||tilt>.1)){cue="TIGHTEN ENVELOPE";severity="caution";}
  ui.flightCue.className=`flight-cue ${severity}`; ui.flightCue.querySelector("strong")!.textContent=cue;
  if (state.phase === "flying") {
    const training=currentMission.id==="qualification"&&!records.tutorialSeen;
    if(assistEnabled)ui.status.textContent="Autoland guidance engaged";
    else if(training&&state.time<4)ui.status.textContent="Flight school: use tilt to center the reticle";
    else if(training&&state.time<9)ui.status.textContent="Flight school: manage vertical speed with throttle";
    else if(training&&state.time<14)ui.status.textContent="Flight school: arrive level inside the target ring";
    else ui.status.textContent = altitude < 8 ? "Touchdown checks active" : targetDistance < 6 ? "Landing solution nominal" : "Correct lateral drift";
    if(training&&state.time>=14){records.tutorialSeen=true;saveRecords(records);}
  }
  if(replaying){
    ui.status.textContent="Flight replay telemetry";
    ui.replayScrubber.value=String(recorder.duration?replayTime/recorder.duration*100:0);
    ui.replayTime.textContent=formatTime(replayTime);
  }
}

function applyLandingAssist() {
  if (!assistEnabled || state.phase !== "flying") {
    controls.assistTiltX=controls.assistTiltZ=controls.assistThrottle=undefined;
    return;
  }
  updateLandingAssist(state,controls);
}

function bindInputs() {
  type DigitalControl = "forward" | "back" | "left" | "right" | "throttleUp" | "throttleDown";
  const keyMap: Record<string, DigitalControl> = { ArrowUp: "forward", ArrowDown: "back", ArrowLeft: "left", ArrowRight: "right", KeyW: "throttleUp", KeyS: "throttleDown", Space: "throttleUp", ShiftLeft: "throttleDown" };
  window.addEventListener("keydown", (event) => {
    void flightAudio.unlock();
    const control = keyMap[event.code]; if (control) { setAssist(false); controls[control] = true; event.preventDefault(); }
    if (!event.repeat && event.code === "KeyC") changeCamera();
    if (!event.repeat && event.code === "KeyA") setAssist(!assistEnabled);
    if (!event.repeat && event.code === "KeyM") toggleMissionDrawer();
    if (!event.repeat && event.code === "KeyV") toggleReplay();
    if (!event.repeat && event.code === "KeyU") toggleAudio();
    if (!event.repeat && event.code === "KeyZ") toggleStabilityMode();
    if (!event.repeat && (event.code === "KeyP" || event.code === "Escape")) togglePause();
    if (!event.repeat && event.code === "KeyR") resetFlight();
  });
  window.addEventListener("keyup", (event) => { const control = keyMap[event.code]; if (control) controls[control] = false; });
  ui.throttle.addEventListener("input", () => { setAssist(false); state.throttle = Number(ui.throttle.value) / 100; });
  document.querySelector("#cameraButton")!.addEventListener("click", changeCamera);
  ui.autoButton.addEventListener("click", () => setAssist(!assistEnabled));
  ui.missionButton.addEventListener("click",toggleMissionDrawer);
  ui.closeMissionButton.addEventListener("click",toggleMissionDrawer);
  ui.replayButton.addEventListener("click",toggleReplay);
  ui.audioButton.addEventListener("click",toggleAudio);
  ui.qualityButton.addEventListener("click",toggleQuality);
  ui.stabilityButton.addEventListener("click",toggleStabilityMode);
  ui.comfortButton.addEventListener("click",toggleCameraComfort);
  ui.deadzoneButton.addEventListener("click",cycleDeadzone);
  ui.trainingButton.addEventListener("click",startTraining);
  ui.drawerAudioButton.addEventListener("click",toggleAudio);
  ui.compareButton.addEventListener("click",()=>{compareEnabled=!compareEnabled;ui.compareButton.classList.toggle("active",compareEnabled);});
  document.querySelector("#touchCamera")!.addEventListener("click",changeCamera);
  document.querySelector("#touchMission")!.addEventListener("click",toggleMissionDrawer);
  document.querySelector("#touchAssist")!.addEventListener("click",()=>setAssist(!assistEnabled));
  document.querySelector("#touchPause")!.addEventListener("click",()=>togglePause());
  document.querySelector("#pauseButton")!.addEventListener("click", () => togglePause());
  document.querySelector("#restartButton")!.addEventListener("click", () => resetFlight());
  ui.modalAction.addEventListener("click", () => state.phase === "flying" ? togglePause(false) : resetFlight());
  ui.modalReplay.addEventListener("click",toggleReplay);
  ui.replayScrubber.addEventListener("input",()=>{ replayTime=Number(ui.replayScrubber.value)/100*recorder.duration; const sample=recorder.sample(replayTime); if(sample)applyReplayState(state,sample); });
  window.addEventListener("pointerdown",()=>void flightAudio.unlock(),{once:true});
  document.querySelectorAll<HTMLButtonElement>("[data-control]").forEach((button) => {
    const name = button.dataset.control as DigitalControl;
    const set = (value: boolean) => { if(value)setAssist(false); controls[name] = value; };
    button.addEventListener("pointerdown", (event) => { button.setPointerCapture(event.pointerId); set(true); });
    button.addEventListener("pointerup", () => set(false)); button.addEventListener("pointercancel", () => set(false));
  });
  window.setTimeout(() => document.querySelector("#hint")?.classList.add("hidden-hint"), 7000);
}

function renderMissionList(){
  ui.missionList.innerHTML="";
  MISSIONS.forEach((mission,index)=>{
    const previous=index>0?MISSIONS[index-1]:undefined;
    const unlocked=!previous||(records.bestScores[previous.id]??0)>=mission.unlockScore;
    const button=document.createElement("button");
    button.className=`mission-card${mission.id===currentMission.id?" active":""}${unlocked?"":" locked"}`;
    button.style.setProperty("--mission-accent",mission.accent);
    const best=records.bestScores[mission.id]??0;
    const medal=medalForScore(best,best>0);
    button.innerHTML=`<span class="number">${mission.number}</span><span><strong>${mission.title}</strong><p>${mission.description}</p><em>${best?`${medal} · PERSONAL BEST ${best}`:unlocked?"READY TO FLY":`REQUIRES ${mission.unlockScore} ON ${previous?.title.toUpperCase()}`}</em></span><small>${mission.difficulty}</small>`;
    button.disabled=!unlocked;
    button.addEventListener("click",()=>selectMission(mission));
    ui.missionList.appendChild(button);
  });
}

function selectMission(mission:MissionDefinition){
  currentMission=mission;
  drawerOpen=false; ui.missionDrawer.classList.add("hidden");
  resetFlight(); applyMissionPresentation(); renderMissionList();
}

function applyMissionPresentation(){
  ui.missionNumber.textContent=`MISSION ${currentMission.number}`;
  const [first,...rest]=currentMission.title.toUpperCase().split(" ");
  ui.missionTitle.innerHTML=`${first} <em>${rest.join(" ")}</em>`;
  const preset=currentMission.environment;
  scene.fog=new THREE.FogExp2(preset.fogColor,preset.fogDensity);
  scene.background=new THREE.Color(preset.fogColor);
  const skyMaterial=(sky as THREE.Mesh).material as THREE.ShaderMaterial;
  skyMaterial.uniforms.topColor.value.setHex(preset.topColor); skyMaterial.uniforms.horizonColor.value.setHex(preset.horizonColor); skyMaterial.uniforms.bottomColor.value.setHex(preset.bottomColor);
  sun.color.setHex(preset.sunColor);sun.intensity=preset.sunIntensity;hemi.intensity=preset.hemisphereIntensity;renderer.toneMappingExposure=preset.exposure;bloom.strength=preset.bloom;
  clouds.children.forEach((cloud,index)=>((cloud as THREE.Sprite).material as THREE.SpriteMaterial).opacity=preset.cloudOpacity*(.72+(index%3)*.14));
  const water=ocean.material as THREE.ShaderMaterial; water.uniforms.uDeep.value.setHex(preset.oceanDeep);water.uniforms.uTop.value.setHex(preset.oceanTop);water.uniforms.uSeaState.value=state.seaState;water.uniforms.uRain.value=preset.rain;
  environmentEffects.apply(preset);
  ui.weatherValue.textContent=preset.label.split(" /")[0];
  document.body.dataset.environment=preset.weather;
  ui.missionDrawer.style.setProperty("--mission-accent",currentMission.accent);
  ui.missionObjectives.innerHTML=currentMission.objectives.map(objective=>`<div class="objective-row"><b>◇</b><span><strong>${objective.label}</strong>${objective.description}</span></div>`).join("");
  updateSettingsLabels();
}

function toggleMissionDrawer(){
  drawerOpen=!drawerOpen; ui.missionDrawer.classList.toggle("hidden",!drawerOpen);
  if(drawerOpen){ paused=true; orbit.enabled=false; hideModal(); }
  else if(state.phase==="flying")paused=false;
}

function toggleReplay(){
  if(!recorder.hasReplay)return;
  if(replaying){ replaying=false; ui.replayTimeline.classList.add("hidden"); ui.replayButton.classList.remove("active");replayPath.visible=false;ghostRocket.visible=false; resetFlight(false); return; }
  replaying=true; replayTime=0; paused=false; endShown=true; setAssist(false); hideModal();
  bestRecorder.load(comparisonFrames);compareEnabled=bestRecorder.hasReplay;ui.compareButton.disabled=!bestRecorder.hasReplay;ui.compareButton.classList.toggle("active",compareEnabled);updateReplayPath();
  ui.replayTimeline.classList.remove("hidden"); ui.replayButton.classList.add("active");
  const sample=recorder.sample(0); if(sample)applyReplayState(state,sample);
}

function toggleAudio(){
  records.audioEnabled=!records.audioEnabled; flightAudio.setEnabled(records.audioEnabled); saveRecords(records);
  ui.audioButton.classList.toggle("active",records.audioEnabled);
  const label=ui.audioButton.querySelector("span"); if(label)label.textContent=records.audioEnabled?"AUDIO":"MUTED";
  updateSettingsLabels();
  if(records.audioEnabled)void flightAudio.unlock();
}

function toggleQuality(){
  records.quality=records.quality==="high"?"low":"high"; saveRecords(records); applyQuality();
}

function toggleCameraComfort(){records.cameraComfort=!records.cameraComfort;saveRecords(records);updateSettingsLabels();}
function cycleDeadzone(){const values=[.08,.12,.18,.24],index=values.findIndex(value=>Math.abs(value-records.gamepadDeadzone)<.001);records.gamepadDeadzone=values[(index+1)%values.length];saveRecords(records);updateSettingsLabels();}
function updateSettingsLabels(){ui.comfortButton.textContent=`CAMERA: ${records.cameraComfort?"COMFORT":"CINEMATIC"}`;ui.deadzoneButton.textContent=`STICK DEADZONE: ${Math.round(records.gamepadDeadzone*100)}%`;ui.drawerAudioButton.textContent=`AUDIO: ${records.audioEnabled?"ON":"MUTED"}`;}
function startTraining(){records.tutorialSeen=false;saveRecords(records);currentMission=MISSIONS[0];drawerOpen=false;ui.missionDrawer.classList.add("hidden");resetFlight();applyMissionPresentation();renderMissionList();const hint=document.querySelector("#hint")!;hint.classList.remove("hidden-hint");hint.innerHTML="<span>FLIGHT SCHOOL ACTIVE</span> CENTER · CONTROL DESCENT · ARRIVE LEVEL";}

function applyQuality(){
  const high=records.quality==="high";
  renderer.setPixelRatio(Math.min(devicePixelRatio,high?2:1));
  renderer.shadowMap.enabled=high; bloom.enabled=high;
  ui.qualityButton.textContent=`GRAPHICS: ${records.quality.toUpperCase()}`;
  ui.audioButton.classList.toggle("active",records.audioEnabled);
  resize();
}

function changeCamera() {
  cameraMode = ((cameraMode + 1) % 3) as CameraMode;
  ui.cameraButton.classList.toggle("active",cameraMode===2);
  const label=ui.cameraButton.querySelector("span"); if(label)label.textContent=["CHASE","DECK","ORBIT"][cameraMode];
  if(cameraMode===2){ camera.position.set(31,20,38); orbit.target.set(0,8,0); orbit.update(); }
}
function setAssist(value:boolean){
  assistEnabled=value && state.phase==="flying";
  if(assistEnabled)state.assistUsed=true;
  ui.autoButton.classList.toggle("active",assistEnabled);
  controls.assistTiltX=controls.assistTiltZ=controls.assistThrottle=undefined;
  controls.rateMode=assistEnabled?false:rateMode;
}

function toggleStabilityMode(){
  rateMode=!rateMode; controls.rateMode=rateMode&&!assistEnabled;
  ui.stabilityButton.textContent=`CONTROL: ${rateMode?"DIRECT RATE":"ATTITUDE HOLD"}`;
}
function togglePause(force?: boolean) { if (state.phase !== "flying"&&!replaying) return; setPaused(force ?? !paused); if (paused) showModal("FLIGHT PAUSED", "Simulation time is frozen. Your landing solution is preserved.", "RESUME FLIGHT", `MISSION ${currentMission.number}`); else hideModal(); }
function setPaused(value: boolean) { paused = value; const label=ui.pauseButton.querySelector("span"); if(label)label.textContent=value?"RESUME":"PAUSE"; orbit.enabled=cameraMode===2&&!value; }
function resetFlight(clearReplay=true) { state = createFlightState(currentMission.init); paused = false; endShown = false; accumulator = 0; replaying=false; replayTime=0; setAssist(false); hideModal(); ui.replayTimeline.classList.add("hidden"); ui.replayButton.classList.remove("active");replayPath.visible=false;ghostRocket.visible=false; if(clearReplay){recorder.reset();ui.replayButton.disabled=true;} snapTrackingCamera(); }
function showEndState() {
  const debrief=createDebrief(state,currentMission);
  if (state.phase === "landed") showModal("TOUCHDOWN", `Contact at ${state.time.toFixed(1)} s · score ${state.touchdownScore}. ${debrief.summary}`, "FLY AGAIN", "MISSION COMPLETE");
  else showModal("VEHICLE LOST", `Contact at ${state.time.toFixed(1)} s. ${debrief.summary}`, "RETRY APPROACH", "MISSION FAILED");
  ui.debrief.classList.remove("hidden");ui.debriefMedal.textContent=debrief.medal;
  ui.debriefMetrics.innerHTML=debrief.metrics.map(metric=>`<div style="--metric-color:${metric.score>70?"#65d88d":metric.score>35?"#ffc45f":"#ff5a1f"}"><span>${metric.label}</span><strong>${metric.value}</strong></div>`).join("");
  ui.debriefObjectives.innerHTML=debrief.objectives.map(objective=>`<div class="${objective.complete?"":"miss"}"><span>${objective.label}</span><b>${objective.complete?"COMPLETE":"MISSED"}</b></div>`).join("")+(debrief.failureReasons.length?debrief.failureReasons.map(reason=>`<div class="miss"><span>LIMIT</span><b>${reason}</b></div>`).join(""):"");
  ui.modalReplay.classList.toggle("hidden",!recorder.hasReplay);
}
function showModal(title: string, copy: string, action: string, eyebrow: string) { ui.modalTitle.textContent = title; ui.modalCopy.textContent = copy; ui.modalAction.textContent = action; ui.modalEyebrow.textContent = eyebrow; ui.modalReplay.classList.add("hidden");ui.debrief.classList.add("hidden"); ui.modal.classList.remove("hidden"); }
function hideModal() { ui.modal.classList.add("hidden"); }
function formatTime(seconds:number){const minutes=Math.floor(seconds/60),secs=seconds-minutes*60;return `${String(minutes).padStart(2,"0")}:${secs.toFixed(1).padStart(4,"0")}`;}
function snapTrackingCamera(){if(cameraMode===2)return;const pose=trackingCameraPose(cameraMode,state.position,camera.aspect);camera.position.set(pose.position.x,pose.position.y,pose.position.z);camera.lookAt(pose.target.x,pose.target.y,pose.target.z);}
function resize() { const w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); composer.setSize(w,h); bloom.setSize(w,h); if(!cameraInitialized){snapTrackingCamera();cameraInitialized=true;} }
function text(id: string) { return document.querySelector<HTMLElement>(`#${id}`)!; }
