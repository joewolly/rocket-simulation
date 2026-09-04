import assert from "node:assert/strict";
import test from "node:test";
import { createLandingFeedback, getLandingDebrief, getLandingReadiness } from "../src/game/landingFeedback.ts";
import { createFlightState, TOUCHDOWN_LIMITS } from "../src/simulation.ts";

function feedbackState() {
  const state=createFlightState({position:{x:0,y:30,z:0},velocity:{x:0,y:0,z:0},wind:{x:0,z:0,gust:0}});
  state.tiltX=state.tiltZ=0;
  state.angularVelocity={x:0,z:0};
  state.legCompression=[0,0,0,0];
  return state;
}

test("readiness distinguishes aligned approach values from contact and safe touchdown",()=>{
  const state=feedbackState();
  const feedback=getLandingReadiness(state);
  assert.equal(feedback.safe,false);
  assert.equal(feedback.positionAligned,true);
  assert.equal(feedback.headline,"APPROACH VALUES WITHIN LIMITS");
  assert.deepEqual(feedback.failureReasons,[]);
  assert.equal(feedback.correctiveTip,"Contact still required; conditions may change.");
  assert.equal(feedback.rows.find((row)=>row.id==="contacts")?.passed,false);
});

test("readiness reports the first actionable approach issue and excludes pending contact",()=>{
  const state=feedbackState();
  state.velocity.y=TOUCHDOWN_LIMITS.verticalSpeed;
  const feedback=getLandingReadiness(state);
  assert.equal(feedback.positionAligned,true);
  assert.deepEqual(feedback.failureReasons,["Vertical speed is at or above the touchdown limit."]);
  assert.equal(feedback.correctiveTip,"Reduce descent rate before the landing legs contact the deck.");
});

test("debrief retains failed contact reason and explains the existing score formula",()=>{
  const state=feedbackState();
  state.phase="crashed";
  const feedback=getLandingDebrief(state);
  assert.equal(feedback.mode,"debrief");
  assert.ok(feedback.failureReasons.includes("Fewer than one landing leg is in contact with the deck."));
  assert.ok(feedback.score);
  assert.equal(feedback.score?.awardedScore,0);
  assert.match(feedback.score?.explanation ?? "",/score is 0/i);
  assert.equal(feedback.rows.length,8);
});

test("debrief score components match touchdown scoring inputs",()=>{
  const state=feedbackState();
  state.legCompression=[1,0,0,0];
  state.phase="landed";
  state.touchdownScore=100;
  const feedback=createLandingFeedback(state,{mode:"debrief",contacts:1});
  assert.equal(feedback.safe,true);
  assert.equal(feedback.score?.components.length,5);
  assert.match(feedback.score?.explanation ?? "",/\(100 − .*\) × 1, rounded =/);
});
