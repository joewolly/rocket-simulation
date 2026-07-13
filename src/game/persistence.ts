export interface PilotRecords {
  bestScores: Record<string, number>;
  completed: string[];
  audioEnabled: boolean;
  quality: "low" | "high";
}

const KEY = "sea-level-pilot-records-v2";
const defaults: PilotRecords = { bestScores:{}, completed:[], audioEnabled:true, quality:"high" };

export function loadRecords(): PilotRecords {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; }
  catch { return structuredClone(defaults); }
}

export function saveRecords(records: PilotRecords) {
  try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* storage can be unavailable */ }
}

export function recordLanding(records: PilotRecords, missionId: string, score: number) {
  records.bestScores[missionId] = Math.max(records.bestScores[missionId] ?? 0, score);
  if (!records.completed.includes(missionId)) records.completed.push(missionId);
  saveRecords(records);
}
