import {
  evaluateLanding,
  type FlightPhase,
  type FlightState,
  type LandingCheck,
  type LandingCheckId,
  type LandingEvaluation,
} from "../simulation";

export type LandingFeedbackMode = "readiness" | "debrief";

export interface LandingFeedbackOptions {
  mode?: LandingFeedbackMode;
  contacts?: number;
  evaluation?: LandingEvaluation;
}

export interface LandingFeedbackRow {
  readonly id: LandingCheckId;
  readonly label: string;
  readonly measured: number;
  readonly limit: number;
  readonly unit: LandingCheck["unit"];
  readonly comparison: LandingCheck["comparison"];
  readonly passed: boolean;
}

export interface LandingScoreComponent {
  readonly id: Exclude<LandingCheckId, "deckX" | "deckZ" | "contacts">;
  readonly label: string;
  readonly measured: number;
  readonly weight: number;
  readonly deduction: number;
  readonly unit: LandingCheck["unit"];
}

export interface LandingScoreBreakdown {
  readonly base: number;
  readonly multiplier: number;
  readonly components: readonly LandingScoreComponent[];
  readonly preMultiplierScore: number;
  readonly calculatedScore: number;
  readonly awardedScore: number;
  readonly explanation: string;
}

export interface LandingFeedback {
  readonly mode: LandingFeedbackMode;
  readonly phase: FlightPhase;
  readonly safe: boolean;
  readonly positionAligned: boolean;
  readonly headline: string;
  readonly summary: string;
  readonly failureReasons: readonly string[];
  readonly rows: readonly LandingFeedbackRow[];
  readonly correctiveTip: string;
  readonly score: LandingScoreBreakdown | null;
}

export function createLandingFeedback(state: FlightState, options: LandingFeedbackOptions = {}): LandingFeedback {
  const mode = options.mode ?? (state.phase === "flying" ? "readiness" : "debrief");
  const evaluation = options.evaluation ?? state.touchdownDiagnostic ?? evaluateLanding(state, options.contacts);
  const rows = evaluation.checks.map(toFeedbackRow);
  const failedChecks = evaluation.checks.filter((check) => !check.passed && (mode === "debrief" || check.id !== "contacts"));
  const approachFailures = evaluation.checks.filter((check) => !check.passed && check.id !== "contacts");
  const pendingContact = mode === "readiness" && !evaluation.measurements.contacts;
  const failureReasons = failedChecks.map(failureReason);
  const positionAligned = evaluation.positionAligned;

  return {
    mode,
    phase: state.phase,
    safe: evaluation.safe,
    positionAligned,
    headline: headline(mode, evaluation.safe, positionAligned, pendingContact, approachFailures.length),
    summary: summary(mode, evaluation.safe, positionAligned, pendingContact, failedChecks.length),
    failureReasons,
    rows,
    correctiveTip: correctiveTip(failedChecks, pendingContact),
    score: mode === "debrief" ? scoreBreakdown(state, evaluation) : null,
  };
}

export function getLandingReadiness(state: FlightState, contacts?: number): LandingFeedback {
  return createLandingFeedback(state, { mode: "readiness", contacts });
}

export function getLandingDebrief(state: FlightState): LandingFeedback {
  return createLandingFeedback(state, { mode: "debrief" });
}

function toFeedbackRow(check: LandingCheck): LandingFeedbackRow {
  return {
    id: check.id,
    label: check.label,
    measured: check.measured,
    limit: check.limit,
    unit: check.unit,
    comparison: check.comparison,
    passed: check.passed,
  };
}

function headline(mode: LandingFeedbackMode, safe: boolean, positionAligned: boolean, pendingContact: boolean, approachFailureCount: number) {
  if (mode === "debrief") return safe ? "TOUCHDOWN ACCEPTED" : "TOUCHDOWN REJECTED";
  if (safe) return "SAFE LANDING CRITERIA MET";
  if (pendingContact && approachFailureCount === 0) return "APPROACH VALUES WITHIN LIMITS";
  return positionAligned ? "POSITION ALIGNED · TOUCHDOWN NOT SAFE" : "POSITION NOT ALIGNED";
}

function summary(mode: LandingFeedbackMode, safe: boolean, positionAligned: boolean, pendingContact: boolean, failureCount: number) {
  if (mode === "debrief") {
    return safe
      ? "Position was aligned and all instantaneous touchdown checks passed at contact."
      : `${failureCount} touchdown ${failureCount === 1 ? "check" : "checks"} failed at contact.`;
  }
  if (safe) return "Position is aligned and all instantaneous touchdown checks are within limits.";
  if (pendingContact && failureCount === 0) return "Approach values are within limits. Contact still required; conditions may change.";
  return positionAligned
    ? "Position is aligned, but the current descent, drift, attitude, or contact state is not safe for touchdown."
    : "Move the booster over the marked target before judging touchdown readiness.";
}

function failureReason(check: LandingCheck): string {
  switch (check.id) {
    case "deckX": return "X position is outside the deck bound.";
    case "deckZ": return "Z position is outside the deck bound.";
    case "targetDistance": return "Target distance is outside the touchdown target.";
    case "verticalSpeed": return "Vertical speed is at or above the touchdown limit.";
    case "horizontalSpeed": return "Lateral drift is at or above the touchdown limit.";
    case "tilt": return "Tilt is at or above the touchdown limit.";
    case "angularSpeed": return "Angular rate is at or above the touchdown limit.";
    case "contacts": return "Fewer than one landing leg is in contact with the deck.";
  }
}

function correctiveTip(failedChecks: readonly LandingCheck[], pendingContact: boolean): string {
  const firstFailure = failedChecks[0];
  if (!firstFailure) {
    return pendingContact
      ? "Contact still required; conditions may change."
      : "Hold the current position and keep every touchdown value within its limit at contact.";
  }
  switch (firstFailure.id) {
    case "deckX":
    case "deckZ":
    case "targetDistance": return "Center the booster over the marked landing target.";
    case "verticalSpeed": return "Reduce descent rate before the landing legs contact the deck.";
    case "horizontalSpeed": return "Cancel lateral drift before contact.";
    case "tilt": return "Level the booster before contact.";
    case "angularSpeed": return "Damp rotation before contact.";
    case "contacts": return "Lower onto the deck until at least one landing leg is compressed.";
  }
}

function scoreBreakdown(state: FlightState, evaluation: LandingEvaluation): LandingScoreBreakdown {
  const measurements = evaluation.measurements;
  const components: LandingScoreComponent[] = [
    scoreComponent("targetDistance", "Target distance", measurements.targetDistance, 8, "m"),
    scoreComponent("verticalSpeed", "Vertical speed", measurements.verticalSpeed, 7, "m/s"),
    scoreComponent("horizontalSpeed", "Lateral drift", measurements.horizontalSpeed, 6, "m/s"),
    scoreComponent("tilt", "Tilt", measurements.tilt, 100, "rad"),
    scoreComponent("angularSpeed", "Angular rate", measurements.angularSpeed, 35, "rad/s"),
  ];
  const preMultiplierScore = components.reduce((score, component) => score - component.deduction, 100);
  const calculatedScore = evaluation.safe
    ? Math.max(0, Math.round(preMultiplierScore * state.scoreMultiplier))
    : 0;
  const explanation = evaluation.safe
    ? `(100 − ${components.map((component) => `${component.label.toLowerCase()} ${formatNumber(component.deduction)}`).join(" − ")}) × ${formatNumber(state.scoreMultiplier)}, rounded = ${calculatedScore}`
    : "Score is 0 because a touchdown check failed; the safe-touchdown score formula was not applied.";

  return {
    base: 100,
    multiplier: state.scoreMultiplier,
    components,
    preMultiplierScore,
    calculatedScore,
    awardedScore: state.touchdownScore,
    explanation,
  };
}

function scoreComponent(
  id: LandingScoreComponent["id"],
  label: string,
  measured: number,
  weight: number,
  unit: LandingCheck["unit"],
): LandingScoreComponent {
  return { id, label, measured, weight, deduction: measured * weight, unit };
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
