# Contributing to SEA LEVEL

Thanks for helping improve SEA LEVEL. The project is a browser-based simulator, so changes should preserve both the playable flight experience and the deterministic simulation contract.

## Development setup

Use Node.js 20.19 or newer (Node.js 22 LTS is also supported), then install dependencies and start Vite:

```bash
npm install
npm run dev
```

The Playwright browser is needed for end-to-end checks:

```bash
npx playwright install chromium
```

## Before opening a pull request

Run the complete verification bundle:

```bash
npm run verify
git diff --check
```

`npm run verify` runs deterministic simulation tests, Playwright desktop/mobile checks, and the production build. Physics changes should include a regression test in `tests/simulation.test.ts`; UI, camera, responsive, or rendering changes should update `tests/e2e/simulation.spec.ts` when behavior changes.

## Project boundaries

- Keep gameplay state and rules independent of Three.js objects.
- Keep deterministic dynamics in `src/simulation.ts` and update the related autopilot and touchdown tests together.
- Keep DOM-based HUD, menus, settings, and accessibility controls out of the renderer.
- Do not add network services, telemetry, or third-party tracking without documenting the change and its data implications.
- Keep generated output (`dist/`, `test-results/`, and `playwright-report/`) out of commits.

Use focused commits and describe the user-visible behavior, verification run, and any known limitations in the pull request.
