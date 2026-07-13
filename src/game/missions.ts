import type { FlightInit } from "../simulation";

export interface MissionDefinition {
  id: string;
  number: string;
  title: string;
  description: string;
  difficulty: "TRAINING" | "STANDARD" | "HARD" | "EXTREME";
  accent: string;
  unlockScore: number;
  init: FlightInit;
}

export const MISSIONS: MissionDefinition[] = [
  {
    id: "qualification", number: "01", title: "Deck Qualification", difficulty: "TRAINING", accent: "#65d88d", unlockScore: 0,
    description: "Calm-water daylight approach with generous fuel and landing assist available.",
    init: { missionId:"qualification", position:{x:7.5,y:36,z:13}, velocity:{x:-.45,y:-2.2,z:-.8}, wind:{x:.6,z:-.25,gust:.22}, seaState:.55, scoreMultiplier:1 },
  },
  {
    id: "crosswind", number: "02", title: "Crosswind Vector", difficulty: "STANDARD", accent: "#ffc45f", unlockScore: 65,
    description: "A strong beam wind demands deliberate lateral correction through final descent.",
    init: { missionId:"crosswind", position:{x:-10,y:42,z:16}, velocity:{x:.4,y:-2.7,z:-1}, wind:{x:4.8,z:.7,gust:1.1}, seaState:.9, fuel:.82, scoreMultiplier:1.2 },
  },
  {
    id: "night", number: "03", title: "Black Horizon", difficulty: "HARD", accent: "#8bb8ff", unlockScore: 75,
    description: "Night recovery with a low visual horizon, rolling deck, and reduced starting fuel.",
    init: { missionId:"night", position:{x:9,y:45,z:19}, velocity:{x:-.9,y:-3,z:-1.2}, wind:{x:2.1,z:-2.8,gust:1.25}, seaState:1.35, fuel:.7, scoreMultiplier:1.45 },
  },
  {
    id: "heavy-sea", number: "04", title: "Heavy Sea", difficulty: "EXTREME", accent: "#ff6b42", unlockScore: 82,
    description: "Large deck motion, gusting wind, and a narrow fuel reserve. Manual mastery recommended.",
    init: { missionId:"heavy-sea", position:{x:-13,y:51,z:22}, velocity:{x:1.1,y:-3.4,z:-1.4}, wind:{x:3.6,z:3.2,gust:2.1}, seaState:2.25, fuel:.58, scoreMultiplier:1.8 },
  },
];

export function missionById(id: string) {
  return MISSIONS.find((mission) => mission.id === id) ?? MISSIONS[0];
}
