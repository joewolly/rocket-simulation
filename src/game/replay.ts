import type { FlightState } from "../simulation";

export interface ReplayFrame {
  t: number;
  state: FlightState;
}

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private lastRecorded = -1;

  reset() { this.frames = []; this.lastRecorded = -1; }

  record(state: FlightState) {
    if (state.time - this.lastRecorded < 1 / 20 && state.phase === "flying") return;
    this.lastRecorded = state.time;
    this.frames.push({ t: state.time, state: structuredClone(state) });
  }

  get duration() { return this.frames.at(-1)?.t ?? 0; }
  get hasReplay() { return this.frames.length > 2; }

  sample(time: number) {
    if (!this.frames.length) return null;
    let low = 0, high = this.frames.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.frames[mid].t <= time) low = mid; else high = mid - 1;
    }
    return structuredClone(this.frames[low].state);
  }
}

export function applyReplayState(target: FlightState, source: FlightState) {
  Object.assign(target, structuredClone(source));
}
