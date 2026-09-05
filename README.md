# Decked Out WNC — Pipeline Tracker

Static site (no build step) using Firebase Auth + Firestore. Deploys to
Cloudflare Pages (auto-deploy on push, once the repo is connected).

## Local development

1. Install the Firebase CLI dev dependency: `npm install`
2. Start the emulators: `npm run emulators` (Firestore on :8080, Auth on
   :9099, emulator UI on :4000)
3. Serve the static files with any local server, e.g. `npx serve .`
4. Open the served URL in a browser.

## Tests

- `npm run test:unit` — pure-logic tests (pipeline stage transitions)
- `npm run test:rules` — Firestore security rules tests, run against the
  emulator automatically

## Roles

- `staff` — full access (owner + office staff)
- `crew` — scoped to assigned jobs only, no financial visibility

See the design doc in the Obsidian vault
(`DZ obsidian/projects/decked-out-wnc/architecture.md`) for the full
pipeline and data model.
