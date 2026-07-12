import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
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
world.add(sky, ocean, ship, rocket, landingMarker, clouds, exhaust.points);

let state = createFlightState();
const controls: Controls = { forward: false, back: false, left: false, right: false, throttleUp: false, throttleDown: false };
let paused = false;
let cameraMode = 0;
let accumulator = 0;
let previousTime = performance.now();
let endShown = false;
let assistEnabled = false;
const fixedDt = 1 / 120;

const ui = {
  altitude: text("altitude"), velocity: text("velocity"), fuel: text("fuel"), drift: text("drift"),
  status: text("statusText"), throttleValue: text("throttleValue"), callout: text("callout"),
  throttle: document.querySelector<HTMLInputElement>("#throttle")!, modal: document.querySelector<HTMLElement>("#modal")!,
  modalEyebrow: text("modalEyebrow"), modalTitle: text("modalTitle"), modalCopy: text("modalCopy"),
  modalAction: document.querySelector<HTMLButtonElement>("#modalAction")!, pauseButton: document.querySelector<HTMLButtonElement>("#pauseButton")!,
  autoButton: document.querySelector<HTMLButtonElement>("#autoButton")!, cameraButton: document.querySelector<HTMLButtonElement>("#cameraButton")!,
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
      applyLandingAssist();
      stepFlight(state, controls, fixedDt);
      accumulator -= fixedDt;
    }
  }
  updateWorld(now / 1000, elapsed);
  updateUi();
  composer.render();
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
  (flame.userData.light as THREE.PointLight).intensity = flameScale * 18;
  updateExhaustTrail(exhaust, visualTime, dt, flameScale);
  clouds.children.forEach((cloud, index) => {
    cloud.position.x += dt * (.32 + index % 3 * .07);
    if (cloud.position.x > 110) cloud.position.x = -110;
  });

  const water = ocean.material as THREE.ShaderMaterial;
  water.uniforms.uTime.value = visualTime;

  const desired = new THREE.Vector3();
  const target = new THREE.Vector3();
  orbit.enabled = cameraMode === 2 && !paused;
  if (cameraMode === 0) {
    desired.set(state.position.x + 25, state.position.y + 14, state.position.z + 32);
    target.set(state.position.x * 0.35, Math.max(3, state.position.y - 7), state.position.z * 0.25);
  } else if (cameraMode === 1) {
    desired.set(-24, 12, 30);
    target.set(state.position.x, Math.max(3, state.position.y), state.position.z);
  } else {
    orbit.target.lerp(new THREE.Vector3(state.position.x * .3, Math.max(3, state.position.y * .35), state.position.z * .2), 1 - Math.exp(-dt * 2));
    orbit.update();
  }
  if (cameraMode !== 2) {
    const ease = 1 - Math.exp(-dt * 2.8);
    camera.position.lerp(desired, ease);
    camera.lookAt(target);
  }

  if (state.phase !== "flying" && !endShown) {
    endShown = true;
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

function createOcean() {
  const geometry = new THREE.PlaneGeometry(500, 500, 80, 80);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x071b22) }, uTop: { value: new THREE.Color(0x1d525b) } },
    vertexShader: `uniform float uTime; varying float vWave; varying vec3 vWorld;
      void main(){ vec3 p=position; float a=sin(p.x*.12+uTime*.85)*.24; float b=sin(p.y*.085-uTime*.68)*.18; float c=sin((p.x+p.y)*.045+uTime*.42)*.30; float d=sin(length(p.xy)*.17-uTime*1.1)*.05; p.z=a+b+c+d; vWave=p.z; vec4 w=modelMatrix*vec4(p,1.); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uDeep; uniform vec3 uTop; varying float vWave; varying vec3 vWorld;
      void main(){ vec3 dx=dFdx(vWorld),dy=dFdy(vWorld); vec3 n=normalize(cross(dx,dy)); if(n.y<0.)n=-n; vec3 viewDir=normalize(cameraPosition-vWorld); float fres=pow(1.-max(dot(n,viewDir),0.),3.); vec3 sunDir=normalize(vec3(-.45,.72,-.3)); float glint=pow(max(dot(reflect(-sunDir,n),viewDir),0.),90.); float foam=smoothstep(.34,.52,vWave)*.18; vec3 col=mix(uDeep,uTop,clamp(vWave+.48,0.,1.)); col+=fres*vec3(.2,.42,.46)+glint*vec3(1.,.72,.42)*1.8+foam; gl_FragColor=vec4(col,1.); }`,
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
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.48, .09, .48), darkMat); foot.position.set(Math.sin(a) * 1.15, -2.82, Math.cos(a) * 1.15); group.add(foot);
  }
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(.5, 3.5, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: .62, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  outer.rotation.x = Math.PI; outer.position.y = -4.1; flame.add(outer);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(.25, 2.2, 14), new THREE.MeshBasicMaterial({ color: 0xfff0b1, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  inner.rotation.x = Math.PI; inner.position.y = -3.6; flame.add(inner);
  const engineLight = new THREE.PointLight(0xff6a28, 0, 11, 2); engineLight.position.y=-3.05; flame.add(engineLight); flame.userData.light=engineLight;
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
  if (state.phase === "flying") ui.status.textContent = assistEnabled ? "Autoland guidance engaged" : altitude < 8 ? "Touchdown checks active" : targetDistance < 6 ? "Landing solution nominal" : "Correct lateral drift";
}

function applyLandingAssist() {
  if (!assistEnabled || state.phase !== "flying") {
    controls.assistTiltX=controls.assistTiltZ=controls.assistThrottle=undefined;
    return;
  }
  const altitude=Math.max(0,state.position.y-ROCKET_HALF_HEIGHT-deckHeightAt(state.position.x,state.position.z,state.time));
  const targetVy=altitude>22?-3.4:altitude>10?-2.15:altitude>3?-1.05:-.42;
  const correction=Math.max(-2.4,Math.min(2.4,(targetVy-state.velocity.y)*1.15));
  const desiredThrust=9.81+correction;
  controls.assistThrottle=Math.max(.37,Math.min(.78,desiredThrust/18.1/Math.max(.92,Math.cos(state.tiltX)*Math.cos(state.tiltZ))));
  const ax=Math.max(-2.1,Math.min(2.1,-state.position.x*.10-state.velocity.x*.52));
  const az=Math.max(-2.1,Math.min(2.1,-state.position.z*.10-state.velocity.z*.52));
  const thrust=Math.max(8,controls.assistThrottle*18.1);
  controls.assistTiltZ=Math.max(-.16,Math.min(.16,Math.asin(ax/thrust)));
  controls.assistTiltX=Math.max(-.16,Math.min(.16,-Math.asin(az/thrust)));
}

function bindInputs() {
  type DigitalControl = "forward" | "back" | "left" | "right" | "throttleUp" | "throttleDown";
  const keyMap: Record<string, DigitalControl> = { ArrowUp: "forward", ArrowDown: "back", ArrowLeft: "left", ArrowRight: "right", KeyW: "throttleUp", KeyS: "throttleDown", Space: "throttleUp", ShiftLeft: "throttleDown" };
  window.addEventListener("keydown", (event) => {
    const control = keyMap[event.code]; if (control) { setAssist(false); controls[control] = true; event.preventDefault(); }
    if (!event.repeat && event.code === "KeyC") changeCamera();
    if (!event.repeat && event.code === "KeyA") setAssist(!assistEnabled);
    if (!event.repeat && (event.code === "KeyP" || event.code === "Escape")) togglePause();
    if (!event.repeat && event.code === "KeyR") resetFlight();
  });
  window.addEventListener("keyup", (event) => { const control = keyMap[event.code]; if (control) controls[control] = false; });
  ui.throttle.addEventListener("input", () => { setAssist(false); state.throttle = Number(ui.throttle.value) / 100; });
  document.querySelector("#cameraButton")!.addEventListener("click", changeCamera);
  ui.autoButton.addEventListener("click", () => setAssist(!assistEnabled));
  document.querySelector("#pauseButton")!.addEventListener("click", () => togglePause());
  document.querySelector("#restartButton")!.addEventListener("click", resetFlight);
  ui.modalAction.addEventListener("click", () => state.phase === "flying" ? togglePause(false) : resetFlight());
  document.querySelectorAll<HTMLButtonElement>("[data-control]").forEach((button) => {
    const name = button.dataset.control as DigitalControl;
    const set = (value: boolean) => { if(value)setAssist(false); controls[name] = value; };
    button.addEventListener("pointerdown", (event) => { button.setPointerCapture(event.pointerId); set(true); });
    button.addEventListener("pointerup", () => set(false)); button.addEventListener("pointercancel", () => set(false));
  });
  window.setTimeout(() => document.querySelector("#hint")?.classList.add("hidden-hint"), 7000);
}

function changeCamera() {
  cameraMode = (cameraMode + 1) % 3;
  ui.cameraButton.classList.toggle("active",cameraMode===2);
  const label=ui.cameraButton.querySelector("span"); if(label)label.textContent=["CHASE","DECK","ORBIT"][cameraMode];
  if(cameraMode===2){ camera.position.set(31,20,38); orbit.target.set(0,8,0); orbit.update(); }
}
function setAssist(value:boolean){
  assistEnabled=value && state.phase==="flying";
  ui.autoButton.classList.toggle("active",assistEnabled);
  controls.assistTiltX=controls.assistTiltZ=controls.assistThrottle=undefined;
}
function togglePause(force?: boolean) { if (state.phase !== "flying") return; setPaused(force ?? !paused); if (paused) showModal("FLIGHT PAUSED", "Simulation time is frozen. Your landing solution is preserved.", "RESUME FLIGHT", "MISSION 04"); else hideModal(); }
function setPaused(value: boolean) { paused = value; const label=ui.pauseButton.querySelector("span"); if(label)label.textContent=value?"RESUME":"PAUSE"; orbit.enabled=cameraMode===2&&!value; }
function resetFlight() { state = createFlightState(); paused = false; endShown = false; accumulator = 0; setAssist(false); hideModal(); }
function showEndState() {
  if (state.phase === "landed") showModal("TOUCHDOWN", `Odyssey secured. Landing quality ${state.touchdownScore}/100. Engines safe.`, "FLY AGAIN", "MISSION COMPLETE");
  else showModal("VEHICLE LOST", "Touchdown limits exceeded. Reduce vertical speed, drift, and tilt before deck contact.", "RETRY APPROACH", "MISSION FAILED");
}
function showModal(title: string, copy: string, action: string, eyebrow: string) { ui.modalTitle.textContent = title; ui.modalCopy.textContent = copy; ui.modalAction.textContent = action; ui.modalEyebrow.textContent = eyebrow; ui.modal.classList.remove("hidden"); }
function hideModal() { ui.modal.classList.add("hidden"); }
function resize() { const w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false); composer.setSize(w,h); bloom.setSize(w,h); }
function text(id: string) { return document.querySelector<HTMLElement>(`#${id}`)!; }
