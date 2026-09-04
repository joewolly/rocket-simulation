import test from "node:test";
import assert from "node:assert/strict";
import { createFlightState, deckHeightAt, deckPose, evaluateLanding, stepFlight, TOUCHDOWN_LIMITS, type Controls } from "../src/simulation.ts";
import { updateLandingAssist } from "../src/game/autopilot.ts";
import { MISSIONS } from "../src/game/missions.ts";
import { loadRecords } from "../src/game/persistence.ts";
import { ReplayRecorder } from "../src/game/replay.ts";

function controls():Controls {
  return { forward:false,back:false,left:false,right:false,throttleUp:false,throttleDown:false };
}

test("manual controls move in their labeled directions",()=>{
  const expected:Record<string,["x"|"z",number]>={forward:["z",-1],back:["z",1],left:["x",-1],right:["x",1]};
  for(const [action,[axis,sign]] of Object.entries(expected)){
    const state=createFlightState({position:{x:0,y:40,z:0},velocity:{x:0,y:0,z:0},wind:{x:0,z:0,gust:0}});
    state.tiltX=state.tiltZ=0; state.throttle=.7;
    const input=controls(); (input as unknown as Record<string,boolean>)[action]=true;
    for(let i=0;i<240;i++)stepFlight(state,input,1/120);
    assert.ok(state.position[axis]*sign>.2,`${action} should move ${axis} with sign ${sign}`);
  }
});

test("direct-rate mode preserves angular momentum after input release",()=>{
  const state=createFlightState({position:{x:0,y:60,z:0},velocity:{x:0,y:0,z:0},wind:{x:0,z:0,gust:0}});
  state.throttle=.7; const input=controls(); input.rateMode=true; input.forward=true;
  for(let i=0;i<120;i++)stepFlight(state,input,1/120);
  input.forward=false; const before=state.tiltX;
  for(let i=0;i<18;i++)stepFlight(state,input,1/120);
  assert.ok(state.tiltX<before,"vehicle should continue rotating briefly after release");
});

test("sea-state setting scales deck motion",()=>{
  const calm=deckPose(3.4,.5),heavy=deckPose(3.4,2.2);
  assert.ok(Math.abs(heavy.y)>Math.abs(calm.y));
  assert.ok(Math.abs(heavy.roll)>Math.abs(calm.roll));
});

function diagnosticState() {
  const state=createFlightState({position:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},wind:{x:0,z:0,gust:0}});
  state.tiltX=state.tiltZ=0;
  state.angularVelocity={x:0,z:0};
  state.legCompression=[1,0,0,0];
  return state;
}

test("landing evaluator reports all touchdown measurements and strict limits",()=>{
  const state=diagnosticState();
  const before=structuredClone(state);
  const evaluation=evaluateLanding(state,1);
  assert.deepEqual(state,before,"evaluation must not mutate flight state");
  assert.equal(evaluation.safe,true);
  assert.equal(evaluation.checks.length,8);
  assert.deepEqual(evaluation.checks.map((check)=>check.id),[
    "deckX","deckZ","targetDistance","verticalSpeed","horizontalSpeed","tilt","angularSpeed","contacts",
  ]);
  assert.equal(evaluation.measurements.contacts,1);
  assert.equal(evaluation.checks.at(-1)?.passed,true);
});

test("landing evaluator rejects each touchdown failure condition at its existing boundary",()=>{
  const cases:[string,(state:ReturnType<typeof diagnosticState>)=>void][]=[
    ["deckX",(state)=>{state.position.x=TOUCHDOWN_LIMITS.deckX;}],
    ["deckZ",(state)=>{state.position.z=TOUCHDOWN_LIMITS.deckZ;}],
    ["targetDistance",(state)=>{state.position.x=TOUCHDOWN_LIMITS.targetDistance;}],
    ["verticalSpeed",(state)=>{state.velocity.y=TOUCHDOWN_LIMITS.verticalSpeed;}],
    ["horizontalSpeed",(state)=>{state.velocity.x=TOUCHDOWN_LIMITS.horizontalSpeed;}],
    ["tilt",(state)=>{state.tiltX=TOUCHDOWN_LIMITS.tilt;}],
    ["angularSpeed",(state)=>{state.angularVelocity.x=TOUCHDOWN_LIMITS.angularSpeed;}],
    ["contacts",(state)=>{}],
  ];
  for(const [id,change] of cases){
    const state=diagnosticState();
    const contacts=id==="contacts"?0:1;
    change(state);
    const evaluation=evaluateLanding(state,contacts);
    assert.equal(evaluation.checks.find((check)=>check.id===id)?.passed,false,`${id} boundary should fail`);
    assert.equal(evaluation.safe,false,`${id} boundary should reject touchdown`);
  }
});

test("landing diagnostic snapshot preserves contact values before resolution clears motion",()=>{
  const state=diagnosticState();
  state.position.y=deckHeightAt(0,0,1/120,state.seaState)+2.9-.15;
  state.velocity.y=-1;
  state.throttle=0;
  stepFlight(state,controls(),1/120);
  assert.equal(state.phase,"landed");
  assert.ok(state.touchdownDiagnostic);
  assert.equal(Object.isFrozen(state.touchdownDiagnostic),true);
  assert.equal(Object.isFrozen(state.touchdownDiagnostic?.measurements),true);
  assert.equal(Object.isFrozen(state.touchdownDiagnostic?.checks),true);
  assert.ok((state.touchdownDiagnostic?.measurements.verticalSpeed ?? 0)>0);
  assert.deepEqual(JSON.parse(JSON.stringify(state.touchdownDiagnostic)),state.touchdownDiagnostic);
  assert.deepEqual(state.velocity,{x:0,y:0,z:0});
});

test("landing assist completes every mission",()=>{
  for(const mission of MISSIONS){
    const state=createFlightState(mission.init),input=controls();
    for(let i=0;i<120*60&&state.phase==="flying";i++){ updateLandingAssist(state,input); stepFlight(state,input,1/120); }
    assert.equal(state.phase,"landed",`${mission.id} did not land`);
    assert.ok(state.touchdownScore>60,`${mission.id} score was too low`);
  }
});

test("replay captures and samples serializable flight state",()=>{
  const recorder=new ReplayRecorder(),state=createFlightState();
  const input=controls();
  for(let i=0;i<240;i++){stepFlight(state,input,1/120);recorder.record(state);}
  assert.ok(recorder.hasReplay);
  const sample=recorder.sample(.5);
  assert.ok(sample&&sample.time<=.55&&sample.time>=.4);
  assert.notEqual(sample,state);
});

test("persistence falls back to safe defaults when browser storage is unavailable",()=>{
  const original = Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{
    configurable:true,
    value:{ getItem:()=>{ throw new Error("storage unavailable"); } },
  });
  try {
    assert.deepEqual(loadRecords(),{ bestScores:{}, completed:[], audioEnabled:true, quality:"high" });
  } finally {
    if(original) Object.defineProperty(globalThis,"localStorage",original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("persistence sanitizes malformed browser records",()=>{
  const original = Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{
    configurable:true,
    value:{ getItem:()=>JSON.stringify({ bestScores:{ deck:84, invalid:-1, text:"bad" }, completed:["deck","deck",4], audioEnabled:"yes", quality:"ultra" }) },
  });
  try {
    assert.deepEqual(loadRecords(),{ bestScores:{ deck:84 }, completed:["deck"], audioEnabled:true, quality:"high" });
  } finally {
    if(original) Object.defineProperty(globalThis,"localStorage",original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
