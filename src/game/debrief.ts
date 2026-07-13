import type { FlightState } from "../simulation";
import type { MissionDefinition, MissionObjective } from "./missions";

export type Medal = "GOLD" | "SILVER" | "BRONZE" | "QUALIFIED" | "NONE";

export interface DebriefMetric { label:string; value:string; score:number; }
export interface ObjectiveResult extends MissionObjective { complete:boolean; }
export interface FlightDebrief {
  medal: Medal;
  summary: string;
  failureReasons: string[];
  metrics: DebriefMetric[];
  objectives: ObjectiveResult[];
}

export function medalForScore(score:number,landed=true):Medal {
  if(!landed)return "NONE";
  if(score>=90)return "GOLD";
  if(score>=78)return "SILVER";
  if(score>=65)return "BRONZE";
  return "QUALIFIED";
}

export function createDebrief(state:FlightState,mission:MissionDefinition):FlightDebrief {
  const landed=state.phase==="landed";
  const degrees=state.touchdownTilt*180/Math.PI;
  const metrics:DebriefMetric[]=[
    {label:"CENTER",value:`${state.touchdownDistance.toFixed(1)} m`,score:grade(state.touchdownDistance,4.5)},
    {label:"VERTICAL",value:`${state.touchdownVerticalSpeed.toFixed(1)} m/s`,score:grade(state.touchdownVerticalSpeed,3.1)},
    {label:"DRIFT",value:`${state.touchdownDrift.toFixed(1)} m/s`,score:grade(state.touchdownDrift,2.1)},
    {label:"ATTITUDE",value:`${degrees.toFixed(1)}°`,score:grade(state.touchdownTilt,.14)},
    {label:"RESERVE",value:`${Math.round(state.fuel*100)}%`,score:Math.round(state.fuel*100)},
  ];
  const failureReasons:string[]=[];
  if(state.touchdownDistance>=4.5)failureReasons.push("Outside the 4.5 m target radius");
  if(state.touchdownVerticalSpeed>=3.1)failureReasons.push("Vertical speed exceeded 3.1 m/s");
  if(state.touchdownDrift>=2.1)failureReasons.push("Lateral drift exceeded 2.1 m/s");
  if(state.touchdownTilt>=.14)failureReasons.push("Vehicle tilt exceeded 8.0°");
  if(state.touchdownAngularSpeed>=.17)failureReasons.push("Angular rate exceeded the landing limit");
  if(state.touchdownContacts<1)failureReasons.push("No landing-leg contact");
  const objectives=mission.objectives.map(objective=>({...objective,complete:objectiveComplete(objective,state)}));
  return {medal:medalForScore(state.touchdownScore,landed),summary:landed?`${mission.title} recovered with a ${medalForScore(state.touchdownScore,true).toLowerCase()} result.`:failureReasons[0]??"Touchdown envelope exceeded.",failureReasons,metrics,objectives};
}

function objectiveComplete(objective:MissionObjective,state:FlightState){
  if(state.phase!=="landed")return false;
  if(objective.id==="precision")return state.touchdownDistance<=objective.limit;
  if(objective.id==="soft")return state.touchdownVerticalSpeed<=objective.limit;
  if(objective.id==="reserve")return state.fuel>=objective.limit;
  return !state.assistUsed;
}

function grade(value:number,limit:number){return Math.max(0,Math.round((1-value/limit)*100));}
