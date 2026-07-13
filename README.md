# SEA LEVEL

An interactive offshore booster-recovery simulator built with Three.js, TypeScript, and Vite. Fly a reusable stage onto the moving drone ship *Odyssey* while managing thrust, angular momentum, wind, fuel, deck motion, and landing-leg contact.

## Run locally

```bash
npm install
npm run dev
```

Production build and verification:

```bash
npm test
npm run test:e2e
npm run build
git diff --check
```

The Playwright browser must be installed once with `npx playwright install chromium`.

## Flight systems

- Fuel-dependent mass and thrust-to-weight ratio
- Engine gimbal slew, torque, angular velocity, and wind torque
- Deterministic gusting wind and mission-specific sea state
- Four independent landing-leg contact points
- Touchdown limits for vertical speed, drift, tilt, and angular rate
- Attitude-hold, direct-rate, and autonomous landing modes
- Radar-altitude callouts, contextual landing-envelope cues, layered procedural audio, and gamepad haptics
- 20 Hz serializable flight recorder with camera-independent scrubbing, flight-path traces, and personal-best ghosts
- Detailed post-flight grading for center accuracy, vertical speed, drift, attitude, fuel reserve, and optional objectives
- Saved mission progression, medals, personal-best scores, best-flight replays, and flight-school state
- High/low graphics modes, comfort/cinematic camera follow, gamepad deadzone calibration, and responsive touch controls
- Mission-driven sky, fog, ocean, lighting, clouds, rain, stars, vessel wake, and sea spray

## Missions

1. **Deck Qualification** — calm-water training approach
2. **Crosswind Vector** — strong lateral wind and reduced fuel
3. **Black Horizon** — night recovery with heavier deck motion
4. **Heavy Sea** — extreme swell, gusting wind, and narrow fuel margin
5. **Whiteout Corridor** — dense sea fog and deceptive quartering wind
6. **Last Light** — dusk glare and a fuel-sensitive long approach

Complete each mission above its unlock threshold to open the next.

## Controls

- Arrow keys: command pitch and roll
- `W` / `S`: increase or decrease throttle
- `Space` / `Left Shift`: alternate throttle controls
- `A`: toggle autonomous landing assist
- `Z`: switch attitude-hold/direct-rate control
- `C`: cycle chase, deck, and free-orbit cameras
- Drag and scroll in orbit camera mode
- `M`: mission and graphics panel
- `V`: replay the most recent flight
- `U`: mute/unmute audio
- `P` or `Escape`: pause/resume
- `R`: restart the approach
- Gamepad: left stick for pitch/roll and triggers for analog throttle
- Touch devices: on-screen flight pad and throttle buttons
- Touch quick actions: missions, camera, landing assist, and pause

The mission drawer also contains graphics quality, control mode, camera comfort, audio, gamepad deadzone, optional objectives, and flight-school controls. Strong camera shake is not used; comfort mode tightens camera following and reduces non-essential environmental motion.

## Architecture

- `src/simulation.ts`: deterministic flight and deck-contact state
- `src/game/autopilot.ts`: landing guidance controller
- `src/game/missions.ts`: scenario definitions and unlock requirements
- `src/game/input.ts`: analog gamepad mapping and haptics
- `src/game/audio.ts`: procedural Web Audio flight feedback
- `src/game/replay.ts`: serializable recorder and playback sampling
- `src/game/persistence.ts`: local pilot records and settings
- `src/game/debrief.ts`: touchdown grading, medals, failure reasons, and optional objectives
- `src/render/cameraRig.ts`: deterministic chase and deck camera framing
- `src/render/environmentEffects.ts`: procedural weather, stars, wake, and spray presentation
- `src/render/assetManifest.ts`: stable GLB runtime contract
- `tests/simulation.test.ts`: deterministic physics regression suite
- `tests/e2e/simulation.spec.ts`: desktop, mobile, WebGL, touchdown, and replay QA

The simulation owns gameplay state independently of Three.js objects. Production vehicle and ship models should be optimized GLB files following [the runtime asset contract](assets/README.md); procedural models remain available as reliable fallbacks.
