# Flight feedback and mobile playability

## Goal

Deliver the first improvement milestone: players can operate the complete game
on touch screens, read their current landing conditions, and understand the
result of each attempt. Preserve the existing flight model, scores, mission
unlocks, saved records, and desktop camera modes.

## Implementation sequence

1. **Landing diagnostics** — `src/simulation.ts`, `src/game/landingFeedback.ts`.
   Share the existing touchdown thresholds with a pure evaluator. Capture all
   checks and score deductions before contact resolution clears motion. Format
   a concise result, measured values against limits, and one corrective tip.
2. **Mobile access and input isolation** — `index.html`, `src/style.css`,
   `src/ui/`, integration in `src/main.ts`.
   Add a compact flight-menu trigger that exposes the existing actions. Preserve
   pause state across panels, clear held controls, block keyboard/touch/gamepad
   flight input and orbit interaction under dialogs, and manage focus. Keep
   drift and throttle visible on mobile.
3. **Accurate cues and framing** — feedback integration and `src/render/`.
   Show climb/descent direction, a camera-relative lateral-motion arrow, and
   current approach checks without implying a guaranteed landing. Frame the
   booster and target together in portrait chase view; respect reduced motion.
4. **Debrief** — `src/ui/`, existing result dialog.
   Present actual failed checks and score deductions with retry/replay actions.
   Keep the full breakdown collapsible so the immediate next action is clear.
5. **Verification and documentation** — unit tests, Playwright, README.
   Exercise touch-only mission/pause/assist/camera/retry/replay flows, overlay
   input isolation, successful and failed debriefs, and narrow/short viewports.
   Inspect generated desktop/mobile screenshots and check control direction.

## Acceptance gates

- Existing touchdown boundaries and scoring remain unchanged; regression cases
  cover each failure condition and diagnostic snapshot serialization.
- All four missions still land with assist.
- Touch users can reach all existing actions, see drift/throttle, and return
  from replay without a keyboard.
- Blocking panels stop flight/camera input and restore focus and prior pause
  state without leaving held controls active.
- Portrait chase framing shows the vehicle and landing target; direction cues
  follow the selected camera rather than assuming world coordinates are screen
  coordinates.
- `npm test`, `npm run test:e2e`, `npm run build`, and `git diff --check` pass.
- Independent review resolves material correctness/regression findings.

## Compatibility and risks

Diagnostics are additive serializable flight data; browser record format and
score gates stay unchanged. Live cues describe instantaneous conditions, not a
future impact prediction. Camera work must preserve desktop framing and manual
directionality. Mobile menus must remain usable in landscape and with safe-area
insets. Keep the existing Vite bundle-size warning visible.

## Later milestones

After this foundation, implement guided qualification exercises, then mastery
medals and replay comparisons, then landing presentation polish. Those require
separate acceptance criteria and playtesting. Preserve existing unlocks when
adding manual medals; historic records do not identify assist usage. Saved
ghosts need explicit versioning and storage limits.

## Implementation outcome

The first milestone is implemented locally. Shared threshold diagnostics,
contact snapshots, live cues, mobile access, portrait framing, and debriefs are
covered by regression and browser tests. Independent review identified an
onboard-camera drift-arrow reversal; the cue now transforms velocity into camera
space, with a dedicated regression case. Boundary failure messages explicitly
include equality. No saved-record migration or score change was introduced.

Validation includes 17 unit tests, seven Playwright scenarios, production build,
and diff whitespace checks. Desktop, portrait, narrow, landscape, success, and
failure screenshots were inspected. The existing Three.js vendor chunk warning
remains (about 525 kB minified). Physical-device and first-time-player playtesting
remain follow-up validation; browser touch emulation does not establish those
results. Later milestones above remain planned, not implemented.
