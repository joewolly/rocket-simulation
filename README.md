# SEA LEVEL

An interactive offshore rocket landing simulation built with Three.js, TypeScript, and Vite. Fly a reusable booster onto a moving drone ship while managing throttle, lateral drift, tilt, descent rate, and fuel.

## Run locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

## Controls

- Arrow keys: tilt the rocket
- `W` / `S`: increase or decrease throttle
- `Space` / `Left Shift`: alternate throttle controls
- `C`: cycle chase, deck, and free-orbit cameras
- Drag and scroll in orbit camera mode to inspect the scene
- `A`: toggle the autonomous landing assist
- `P` or `Escape`: pause/resume
- `R`: restart the approach
- On touch devices, use the on-screen flight pad and throttle buttons

## Touchdown envelope

Land inside the target ring with vertical speed below 3.1 m/s, horizontal drift below 2.1 m/s, and tilt below approximately 8 degrees. The deck heaves and rolls with the sea, so the safe throttle changes throughout the final approach.

The flight simulation is kept separate from Three.js scene objects in `src/simulation.ts`; the renderer treats state as its input rather than the source of gameplay rules.
