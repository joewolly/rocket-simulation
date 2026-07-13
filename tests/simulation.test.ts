import test from "node:test";
import assert from "node:assert/strict";
import { createFlightState, deckPose, stepFlight, type Controls } from "../src/simulation.ts";
import { updateLandingAssist } from "../src/game/autopilot.ts";
import { MISSIONS } from "../src/game/missions.ts";
import { ReplayRecorder } from "../src/game/replay.ts";
import { trackingCameraPose } from "../src/render/cameraRig.ts";
import { createDebrief, medalForScore } from "../src/game/debrief.ts";

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

test("tracking cameras derive a stable pose from flight state",()=>{
  const rocket={x:7.5,y:36,z:13};
  const chase=trackingCameraPose(0,rocket);
  const deck=trackingCameraPose(1,rocket);

  assert.deepEqual(chase,trackingCameraPose(0,rocket));
  assert.deepEqual(chase.position,{x:32.5,y:50,z:45});
  assert.deepEqual(deck.position,{x:-24,y:12,z:30});
  assert.deepEqual(deck.target,rocket);
  assert.notDeepEqual(trackingCameraPose(0,rocket,.46).position,chase.position);
});

test("mission environments and touchdown debriefs remain deterministic",()=>{
  assert.equal(MISSIONS.length,6);
  assert.deepEqual(MISSIONS.map(mission=>mission.environment.weather),["clear","crosswind","night","storm","fog","dusk"]);
  const mission=MISSIONS[0],state=createFlightState(mission.init),input=controls();
  for(let i=0;i<120*60&&state.phase==="flying";i++){updateLandingAssist(state,input);stepFlight(state,input,1/120);}
  const debrief=createDebrief(state,mission);
  assert.equal(state.phase,"landed");
  assert.notEqual(debrief.medal,"NONE");
  assert.equal(debrief.metrics.length,5);
  assert.ok(debrief.objectives.some(objective=>objective.complete));
  assert.equal(medalForScore(92),"GOLD");
});

test("debrief identifies the touchdown envelope that was exceeded",()=>{
  const state=createFlightState(MISSIONS[0].init);
  state.phase="crashed";state.touchdownVerticalSpeed=3.8;state.touchdownDrift=2.6;state.touchdownDistance=5.2;state.touchdownTilt=.2;state.touchdownAngularSpeed=.22;state.touchdownContacts=1;
  const debrief=createDebrief(state,MISSIONS[0]);
  assert.equal(debrief.medal,"NONE");
  assert.ok(debrief.failureReasons.some(reason=>reason.includes("Vertical speed")));
  assert.ok(debrief.failureReasons.some(reason=>reason.includes("target radius")));
});
