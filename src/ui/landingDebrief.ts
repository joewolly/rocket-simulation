import type { LandingFeedback } from "../game/landingFeedback";

/** Render plain text from captured contact data; keep details out of the playfield. */
export function renderLandingDebrief(root: HTMLElement, feedback: LandingFeedback) {
  root.replaceChildren();
  root.hidden = false;
  const tip = document.createElement("p");
  tip.className = "next-attempt";
  tip.textContent = `Next attempt: ${feedback.correctiveTip}`;
  root.append(tip);
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Contact checks & score breakdown";
  details.append(summary);
  const table = document.createElement("table");
  table.innerHTML = "<caption>Displayed values are rounded; checks use full precision.</caption><thead><tr><th scope='col'>Check</th><th scope='col'>At contact</th><th scope='col'>Required</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const row of feedback.rows) {
    const tr = document.createElement("tr");
    tr.dataset.passed = String(row.passed);
    const angular = row.unit === "rad" || String(row.unit) === "rad/s";
    const factor = angular ? 180 / Math.PI : 1;
    const unit = row.unit === "rad" ? "°" : String(row.unit) === "rad/s" ? "°/s" : row.unit;
    const format = (value: number) => `${(value * factor).toFixed(row.id === "contacts" ? 0 : 2)} ${unit}`;
    for (const value of [`${row.passed ? "PASS" : "FAIL"} · ${row.label}`, format(row.measured), `${row.comparison === "less-than" ? "<" : "≥"} ${format(row.limit)}`]) {
      const td = document.createElement("td"); td.textContent = value; tr.append(td);
    }
    body.append(tr);
  }
  table.append(body); details.append(table);
  if (feedback.score) {
    const score = document.createElement("p");
    score.className = "score-explanation";
    score.textContent = feedback.score.explanation;
    details.append(score);
  }
  root.append(details);
}
