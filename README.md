# Decked Out WNC — Pipeline Tracker

Static site (no build step) using Firebase Auth + Firestore + Storage.
Deploys to Cloudflare Pages (auto-deploy on push, once the repo is
connected).

## Local development

1. Install the Firebase CLI dev dependency: `npm install`
2. Start the emulators: `npm run emulators` (Firestore on :8080, Auth on
   :9099, Storage on :9199, emulator UI on :4000)
3. Serve the static files with any local server, e.g. `npx serve .`
4. Open the served URL in a browser.

## Tests

- `npm run test:unit` — pure-logic tests (pipeline stage transitions)
- `npm run test:rules` — Firestore AND Storage security rules tests, run
  against the emulator automatically

## Deploying

**Deploy both rule sets together** — `firebase deploy --only
firestore:rules,storage`. Deploying only `firestore:rules` leaves the
Storage bucket on whatever it was before (a brand-new bucket defaults to
"any authenticated user can read/write everything," which would expose
every materials receipt to the `crew` role). See `known-issues.md` in the
Obsidian vault for the full reasoning.

## Roles

- `staff` — full access (owner + office staff)
- `crew` — scoped to assigned jobs only, no financial visibility

See the design doc in the Obsidian vault
(`DZ obsidian/projects/decked-out-wnc/architecture.md`) for the full
pipeline and data model.
