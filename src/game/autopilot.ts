import { deckHeightAt, ROCKET_HALF_HEIGHT, type Controls, type FlightState } from "../simulation";

export function updateLandingAssist(state:FlightState,controls:Controls) {
  const altitude=Math.max(0,state.position.y-ROCKET_HALF_HEIGHT-deckHeightAt(state.position.x,state.position.z,state.time,state.seaState));
  const targetVy=altitude>22?-3.4:altitude>10?-2.15:altitude>3?-1.05:-.42;
  const correction=clamp((targetVy-state.velocity.y)*1.15,-2.4,2.4);
  const desiredThrust=9.81+correction;
  const massScale=35_000/state.mass;
  controls.assistThrottle=clamp(desiredThrust/(18.1*massScale)/Math.max(.92,Math.cos(state.tiltX)*Math.cos(state.tiltZ)),.3,.78);
  const ax=clamp(-state.position.x*.10-state.velocity.x*.52,-2.1,2.1);
  const az=clamp(-state.position.z*.10-state.velocity.z*.52,-2.1,2.1);
  const thrust=Math.max(8,controls.assistThrottle*18.1*massScale);
  controls.assistTiltZ=clamp(-Math.asin(ax/thrust),-.16,.16);
  controls.assistTiltX=clamp(Math.asin(az/thrust),-.16,.16);
  controls.rateMode=false;
}

function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
