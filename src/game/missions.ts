import type { FlightInit } from "../simulation";

export interface MissionObjective {
  id: "precision" | "soft" | "reserve" | "manual";
  label: string;
  description: string;
  limit: number;
}

export interface EnvironmentPreset {
  weather: "clear" | "crosswind" | "night" | "storm" | "fog" | "dusk";
  label: string;
  topColor: number;
  horizonColor: number;
  bottomColor: number;
  fogColor: number;
  fogDensity: number;
  oceanDeep: number;
  oceanTop: number;
  sunColor: number;
  sunIntensity: number;
  hemisphereIntensity: number;
  exposure: number;
  bloom: number;
  cloudOpacity: number;
  rain: number;
  stars: boolean;
}

export interface MissionDefinition {
  id: string;
  number: string;
  title: string;
  description: string;
  difficulty: "TRAINING" | "STANDARD" | "HARD" | "EXTREME";
  accent: string;
  unlockScore: number;
  objectives: MissionObjective[];
  environment: EnvironmentPreset;
  init: FlightInit;
}

const clear: EnvironmentPreset = { weather:"clear",label:"CLEAR / DAY",topColor:0x1f526c,horizonColor:0xb9c9c4,bottomColor:0x486b72,fogColor:0x81989a,fogDensity:.009,oceanDeep:0x031a22,oceanTop:0x26717a,sunColor:0xffe2b0,sunIntensity:3.5,hemisphereIntensity:2.3,exposure:1.08,bloom:.24,cloudOpacity:.6,rain:0,stars:false };
const precision: MissionObjective = {id:"precision",label:"CENTERLINE",description:"Touch down within 2.0 m of the target.",limit:2};
const soft: MissionObjective = {id:"soft",label:"SOFT CONTACT",description:"Vertical contact speed below 1.5 m/s.",limit:1.5};
const reserve: MissionObjective = {id:"reserve",label:"FUEL RESERVE",description:"Finish with at least 15% propellant.",limit:.15};
const manual: MissionObjective = {id:"manual",label:"HAND FLOWN",description:"Land without autonomous guidance.",limit:0};

export const MISSIONS: MissionDefinition[] = [
  {
    id: "qualification", number: "01", title: "Deck Qualification", difficulty: "TRAINING", accent: "#65d88d", unlockScore: 0,
    description: "Calm-water daylight approach with generous fuel and landing assist available.",
    objectives:[precision,soft], environment:clear,
    init: { missionId:"qualification", position:{x:7.5,y:36,z:13}, velocity:{x:-.45,y:-2.2,z:-.8}, wind:{x:.6,z:-.25,gust:.22}, seaState:.55, scoreMultiplier:1 },
  },
  {
    id: "crosswind", number: "02", title: "Crosswind Vector", difficulty: "STANDARD", accent: "#ffc45f", unlockScore: 65,
    description: "A strong beam wind demands deliberate lateral correction through final descent.",
    objectives:[precision,reserve], environment:{...clear,weather:"crosswind",label:"HAZE / CROSSWIND",topColor:0x355c69,horizonColor:0xc6c2ae,fogColor:0x9a9b8d,fogDensity:.013,oceanTop:0x356b70,cloudOpacity:.78},
    init: { missionId:"crosswind", position:{x:-10,y:42,z:16}, velocity:{x:.4,y:-2.7,z:-1}, wind:{x:4.8,z:.7,gust:1.1}, seaState:.9, fuel:.82, scoreMultiplier:1.2 },
  },
  {
    id: "night", number: "03", title: "Black Horizon", difficulty: "HARD", accent: "#8bb8ff", unlockScore: 75,
    description: "Night recovery with a low visual horizon, rolling deck, and reduced starting fuel.",
    objectives:[soft,manual], environment:{...clear,weather:"night",label:"CLEAR / NIGHT",topColor:0x020816,horizonColor:0x142f49,bottomColor:0x01040a,fogColor:0x06111d,fogDensity:.015,oceanDeep:0x01070d,oceanTop:0x092d3a,sunColor:0x9ebcff,sunIntensity:.5,hemisphereIntensity:.75,exposure:.88,bloom:.48,cloudOpacity:.28,stars:true},
    init: { missionId:"night", position:{x:9,y:45,z:19}, velocity:{x:-.9,y:-3,z:-1.2}, wind:{x:2.1,z:-2.8,gust:1.25}, seaState:1.35, fuel:.7, scoreMultiplier:1.45 },
  },
  {
    id: "heavy-sea", number: "04", title: "Heavy Sea", difficulty: "EXTREME", accent: "#ff6b42", unlockScore: 82,
    description: "Large deck motion, gusting wind, and a narrow fuel reserve. Manual mastery recommended.",
    objectives:[soft,reserve,manual], environment:{...clear,weather:"storm",label:"SQUALL / HEAVY SEA",topColor:0x101b22,horizonColor:0x52636a,bottomColor:0x0b1217,fogColor:0x2f4147,fogDensity:.021,oceanDeep:0x020b10,oceanTop:0x183b43,sunColor:0xa9b8bd,sunIntensity:1.35,hemisphereIntensity:1.25,exposure:.88,bloom:.18,cloudOpacity:.95,rain:.85},
    init: { missionId:"heavy-sea", position:{x:-13,y:51,z:22}, velocity:{x:1.1,y:-3.4,z:-1.4}, wind:{x:3.6,z:3.2,gust:2.1}, seaState:2.25, fuel:.58, scoreMultiplier:1.8 },
  },
  {
    id:"whiteout",number:"05",title:"Whiteout Corridor",difficulty:"EXTREME",accent:"#d7edf0",unlockScore:86,
    description:"Dense sea fog strips away the horizon while a shifting quartering wind masks drift.",
    objectives:[precision,soft,manual], environment:{...clear,weather:"fog",label:"DENSE FOG",topColor:0x718084,horizonColor:0xb8c1be,bottomColor:0x5c6b6e,fogColor:0x9ba8a7,fogDensity:.038,oceanDeep:0x10272c,oceanTop:0x42666b,sunColor:0xe8e5d9,sunIntensity:1.8,hemisphereIntensity:2,exposure:.98,bloom:.12,cloudOpacity:.35,rain:.22},
    init:{missionId:"whiteout",position:{x:11,y:43,z:18},velocity:{x:-.7,y:-2.8,z:-1.1},wind:{x:-3.1,z:2.6,gust:1.45},seaState:1.4,fuel:.68,scoreMultiplier:1.65},
  },
  {
    id:"last-light",number:"06",title:"Last Light",difficulty:"HARD",accent:"#ff9d62",unlockScore:84,
    description:"A long dusk approach rewards precise energy management as the deck disappears into glare.",
    objectives:[precision,reserve,manual], environment:{...clear,weather:"dusk",label:"DUSK / GLARE",topColor:0x172b4c,horizonColor:0xe49a75,bottomColor:0x492d35,fogColor:0x6d5960,fogDensity:.016,oceanDeep:0x06131e,oceanTop:0x354a5a,sunColor:0xff9b64,sunIntensity:2.65,hemisphereIntensity:1.45,exposure:1.02,bloom:.42,cloudOpacity:.72},
    init:{missionId:"last-light",position:{x:-8,y:58,z:28},velocity:{x:.6,y:-3.2,z:-1.7},wind:{x:2.8,z:-1.8,gust:1.15},seaState:1.1,fuel:.62,scoreMultiplier:1.55},
  },
];

export function missionById(id: string) {
  return MISSIONS.find((mission) => mission.id === id) ?? MISSIONS[0];
}
