# SEA LEVEL contributor guidance

These instructions apply to the entire repository.

## Project intent

SEA LEVEL is an interactive offshore booster-recovery simulator built with Three.js, TypeScript, and Vite. Preserve the feeling of mass, momentum, environmental motion, and precise vehicle control. Changes should improve the playable simulation rather than turn the interface into a dashboard.

## Architecture boundaries

- Keep serializable gameplay state and rules independent of Three.js objects.
- `src/simulation.ts` owns deterministic flight dynamics, deck motion, contacts, and touchdown resolution.
- `src/game/` owns autopilot, missions, physical input mapping, audio, replay, and persistence.
- Rendering treats simulation state as input. Never store authoritative gameplay state on meshes, materials, cameras, or particle systems.
- Keep text-heavy HUD, menus, settings, and accessibility controls in the DOM.
- Save simulation data, settings, and records—not renderer objects.
- Prefer small focused modules over adding more responsibilities to `src/main.ts`.

## Simulation conventions

- Use meters, seconds, kilograms, and radians internally.
- World up is `+Y`.
- Booster thrust points along its local `+Y` axis.
- A negative X tilt moves the booster toward world `-Z`.
- A negative Z tilt moves the booster toward world `+X`.
- Manual controls must move the vehicle in their labeled screen direction and must visually lean the booster in that same direction.
- Advance gameplay through the fixed simulation timestep. Do not make physics depend on render-frame rate.
- Keep wind, sea motion, missions, and assisted landings deterministic unless randomness is explicitly seeded and tested.
- When changing physics, update attitude hold, direct-rate control, and landing assist together.
- Touchdown logic must continue considering deck bounds, target distance, vertical speed, lateral drift, tilt, angular rate, and landing-leg contacts.

## Rendering and assets

- Keep the central playfield clear and persistent HUD coverage restrained.
- Preserve chase, deck, and orbit camera behavior when changing scene scale or vehicle dimensions.
- Handle resize, mobile safe areas, reduced motion, and WebGL context loss.
- Production 3D assets must use optimized GLB or glTF 2.0. Follow `assets/README.md` and register stable keys in `src/render/assetManifest.ts`.
- Procedural models are supported runtime fallbacks; do not remove them until replacement assets load and validate reliably.
- Reuse materials, pool transient effects, and avoid unnecessary draw calls or large uncompressed textures.
- Strong post-processing must remain optional through the graphics-quality setting.

## Interaction and accessibility

- Maintain keyboard, touch, and gamepad support.
- Do not let camera or flight controls remain active under blocking menus and dialogs.
- Any new physical action must be mapped centrally and documented in `README.md`.
- Flight audio must remain opt-in after a user gesture and respect the saved mute setting.
- Keep mission progression and personal records backward-compatible when changing persisted data.

## Required verification

Run these before considering a change complete:

```bash
npm test
npm run test:e2e
npm run build
git diff --check
```

- Physics changes require regression coverage in `tests/simulation.test.ts`.
- UI, camera, shader, asset, or responsive changes require Playwright coverage and screenshot inspection.
- Reverify manual control directionality after changing tilt, thrust, camera, or input math.
- Reverify assisted touchdown for every mission after changing physics, wind, deck motion, mass, thrust, or guidance.
- Treat the Vite chunk-size message as a performance signal; do not suppress it without addressing or documenting the underlying bundle cost.

## Repository hygiene

- Do not commit `node_modules/`, `dist/`, `.vite/`, `test-results/`, `playwright-report/`, logs, or local configuration.
- Preserve unrelated user changes in a dirty worktree.
- Keep secrets and credentials out of source, tests, documentation, and command output.
- Update `README.md` whenever controls, missions, setup, verification, or architecture materially change.
