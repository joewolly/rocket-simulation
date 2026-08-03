export interface PilotRecords {
  bestScores: Record<string, number>;
  completed: string[];
  audioEnabled: boolean;
  quality: "low" | "high";
}

const KEY = "sea-level-pilot-records-v2";
const defaults: PilotRecords = { bestScores:{}, completed:[], audioEnabled:true, quality:"high" };

export function loadRecords(): PilotRecords {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!isObject(value)) return structuredClone(defaults);
    return {
      bestScores: sanitizeScores(value.bestScores),
      completed: sanitizeCompleted(value.completed),
      audioEnabled: typeof value.audioEnabled === "boolean" ? value.audioEnabled : defaults.audioEnabled,
      quality: value.quality === "low" || value.quality === "high" ? value.quality : defaults.quality,
    };
  } catch {
    // Storage can be unavailable (for example in private browsing or blocked contexts).
    return structuredClone(defaults);
  }
}

export function saveRecords(records: PilotRecords) {
  try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* storage can be unavailable */ }
}

export function recordLanding(records: PilotRecords, missionId: string, score: number) {
  records.bestScores[missionId] = Math.max(records.bestScores[missionId] ?? 0, score);
  if (!records.completed.includes(missionId)) records.completed.push(missionId);
  saveRecords(records);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeScores(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => {
      const [, score] = entry;
      return typeof score === "number" && Number.isFinite(score) && score >= 0;
    }),
  );
}

function sanitizeCompleted(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((missionId): missionId is string => typeof missionId === "string"))];
}
