import test from "node:test";
import assert from "node:assert/strict";
import { createFlightState, deckPose, stepFlight, type Controls } from "../src/simulation.ts";
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
