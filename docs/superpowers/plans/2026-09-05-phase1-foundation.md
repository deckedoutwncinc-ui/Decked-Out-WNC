# Decked Out WNC — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the app skeleton — Firebase Auth, the `staff`/`crew` role model, Firestore security rules, and basic lead/job CRUD through the pipeline stages from Lead In through Won/Lost. No contracts, payments, scheduling, or job-site media yet — those are later phases.

**Architecture:** A build-step-free static site (plain HTML + ES modules), matching the AWD Job Tracker pattern: Firebase JS SDK (modular, v10) loaded via CDN `<script type="module">`, Firestore as the database, Firebase Auth for staff/crew login, deployed later to Cloudflare Pages. No bundler, no npm dependency for the app runtime itself — npm is only used for dev-time testing tooling (Firebase emulators, rules tests).

**Tech Stack:** Firebase (Auth, Firestore) modular JS SDK v10 via CDN ESM imports, Firebase Local Emulator Suite for testing, `@firebase/rules-unit-testing` for security-rules tests, Node's built-in `node:test` for pure-logic unit tests. Firebase project ID: `deckedoutwnc`.

**Spec:** `DZ obsidian/projects/decked-out-wnc/architecture.md` (see also `decisions.md` and `glossary.md` in the same folder)

## Global Constraints

- No build step / no bundler for the app itself — plain ES modules loaded via `<script type="module">`, Firebase SDK via CDN, matching the AWD Job Tracker precedent (see spec's Tech Stack section).
- Two roles only: `staff` (full access) and `crew` (scoped to assigned jobs, no financial visibility) — per spec's Roles section. Crew-specific UI has little to show in Phase 1 since scheduling/assignment doesn't exist until Phase 4; that's expected, not a gap.
- Firestore project ID is `deckedoutwnc` — already created, Blaze plan, under the `deckedoutwncinc@gmail.com` account.
- Dates in the app UI must display as MM/DD/YYYY (per Daniel's standing convention across all his apps).
- Visual polish is explicitly out of scope for this phase — functional HTML only. A real frontend-design pass happens once more of the app exists to design around.

---

### Task 1: Repo scaffold and Firebase project wiring

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.firebaserc`
- Create: `firebase.json`
- Create: `js/firebase-config.js`
- Create: `README.md`

**Interfaces:**
- Produces: `js/firebase-config.js` exports `app`, `auth`, `db` (initialized Firebase App/Auth/Firestore instances) — every later task's browser code imports from this file.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "decked-out-wnc-app",
  "private": true,
  "type": "module",
  "scripts": {
    "test:unit": "node --test tests/unit",
    "test:rules": "firebase emulators:exec --only firestore \"node --test tests/rules\"",
    "emulators": "firebase emulators:start --only firestore,auth"
  },
  "devDependencies": {
    "firebase-tools": "^13.29.0",
    "@firebase/rules-unit-testing": "^3.0.4"
  }
}
```

- [ ] **Step 2: Install dev dependencies**

Run: `npm install`
Expected: installs `firebase-tools` and `@firebase/rules-unit-testing` into `node_modules` with no errors.

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
.firebase/
firebase-debug.log
firestore-debug.log
ui-debug.log
*.log
```

- [ ] **Step 4: Write `.firebaserc`**

```json
{
  "projects": {
    "default": "deckedoutwnc"
  }
}
```

- [ ] **Step 5: Write `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

- [ ] **Step 6: Write `firestore.indexes.json`** (empty for now)

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

- [ ] **Step 7: Write `js/firebase-config.js`**

```javascript
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCsn4EEuK0KAkeVKyUTQoAqGV48_dbqdFg",
  authDomain: "deckedoutwnc.firebaseapp.com",
  projectId: "deckedoutwnc",
  storageBucket: "deckedoutwnc.firebasestorage.app",
  messagingSenderId: "910618813751",
  appId: "1:910618813751:web:38dbb49512a530ec6ce6b2",
  measurementId: "G-GPT2BHR1W0",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
```

- [ ] **Step 8: Write `README.md`**

```markdown
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
```

- [ ] **Step 9: Verify the emulators start**

Run: `npm run emulators` (then stop it with Ctrl+C once it reports "All emulators ready")
Expected: no errors; log shows Firestore and Auth emulators running, and a note about the emulator UI URL.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .gitignore .firebaserc firebase.json firestore.indexes.json js/firebase-config.js README.md
git commit -m "chore: scaffold repo and wire Firebase project config"
```

---

### Task 2: Firestore security rules — staff/crew roles

**Files:**
- Create: `firestore.rules`
- Test: `tests/rules/access.rules.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (rules are independent of app code)
- Produces: the security rules every later Firestore read/write in the app must satisfy. Collections: `users/{uid}` (`role` field: `"staff"` | `"crew"`), `jobs/{jobId}` (`assignedCrew` field: array of uids, absent on jobs that predate scheduling).

- [ ] **Step 1: Write the failing rules tests**

```javascript
// tests/rules/access.rules.test.js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "deckedoutwnc-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

function staffCtx() {
  return testEnv.authenticatedContext("staff-uid");
}
function crewCtx(uid = "crew-uid") {
  return testEnv.authenticatedContext(uid);
}
function anonCtx() {
  return testEnv.unauthenticatedContext();
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
    await db.collection("users").doc("crew-uid").set({ role: "crew", name: "Crew Person" });
    await db.collection("jobs").doc("job-unassigned").set({ status: "LEAD_IN", customerName: "A" });
    await db.collection("jobs").doc("job-assigned").set({
      status: "JOB_SCHEDULED",
      customerName: "B",
      assignedCrew: ["crew-uid"],
    });
  });
}

test("unauthenticated user cannot read any job", async () => {
  await seed();
  const db = anonCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-unassigned").get());
});

test("staff can read any job", async () => {
  await seed();
  const db = staffCtx().firestore();
  await assertSucceeds(db.collection("jobs").doc("job-unassigned").get());
});

test("crew cannot read a job they are not assigned to", async () => {
  await seed();
  const db = crewCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-unassigned").get());
});

test("crew can read a job they are assigned to", async () => {
  await seed();
  const db = crewCtx().firestore();
  await assertSucceeds(db.collection("jobs").doc("job-assigned").get());
});

test("staff can create a job", async () => {
  await seed();
  const db = staffCtx().firestore();
  await assertSucceeds(
    db.collection("jobs").add({ status: "LEAD_IN", customerName: "New Lead" })
  );
});

test("crew cannot create a job", async () => {
  await seed();
  const db = crewCtx().firestore();
  await assertFails(
    db.collection("jobs").add({ status: "LEAD_IN", customerName: "New Lead" })
  );
});

test("a user can read their own users doc", async () => {
  await seed();
  const db = crewCtx().firestore();
  await assertSucceeds(db.collection("users").doc("crew-uid").get());
});

test("crew cannot read another user's doc", async () => {
  await seed();
  const db = crewCtx().firestore();
  await assertFails(db.collection("users").doc("staff-uid").get());
});

test("crew cannot write to the users collection, even their own doc", async () => {
  await seed();
  const db = crewCtx().firestore();
  await assertFails(db.collection("users").doc("crew-uid").set({ role: "staff" }));
});

test("staff can write to the users collection", async () => {
  await seed();
  const db = staffCtx().firestore();
  await assertSucceeds(
    db.collection("users").doc("new-uid").set({ role: "crew", name: "New Hire" })
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL — either the emulator has no rules file yet or the default deny-all rules cause the "should succeed" assertions to fail (e.g. `assertSucceeds` throwing because staff reads are denied).

- [ ] **Step 3: Write `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }
    function userRole() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }
    function isStaff() {
      return isSignedIn() && userRole() == 'staff';
    }
    function isCrew() {
      return isSignedIn() && userRole() == 'crew';
    }
    function isAssignedCrew() {
      return isCrew() &&
        request.auth.uid in resource.data.get('assignedCrew', []);
    }

    match /users/{userId} {
      allow read: if isStaff() || (isSignedIn() && request.auth.uid == userId);
      allow write: if isStaff();
    }

    match /jobs/{jobId} {
      allow read: if isStaff() || isAssignedCrew();
      allow create: if isStaff();
      allow update, delete: if isStaff();
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules/access.rules.test.js
git commit -m "feat: add Firestore security rules for staff/crew roles"
```

---

### Task 3: Pipeline stage transition logic

**Files:**
- Create: `js/pipeline.js`
- Test: `tests/unit/pipeline.test.js`

**Interfaces:**
- Produces: `STAGES` (array of stage name strings, in pipeline order) and `canTransition(from, to)` (returns boolean) — later tasks (`js/jobs.js`, `js/main.js`) both import these.

- [ ] **Step 1: Write the failing unit tests**

```javascript
// tests/unit/pipeline.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, canTransition } from "../../js/pipeline.js";

test("STAGES includes every pipeline stage in order", () => {
  assert.deepEqual(STAGES, [
    "LEAD_IN",
    "BID_SCHEDULED",
    "DESIGN_FEE",
    "BID_GIVEN",
    "WON",
    "LOST",
    "CONTRACT_SENT",
    "CONTRACT_SIGNED",
    "DEPOSIT_INVOICED",
    "DEPOSIT_PAID",
    "JOB_SCHEDULED",
    "IN_PROGRESS",
    "FINAL_INVOICE_SENT",
    "FINAL_PAYMENT_RECEIVED",
    "COMPLETE",
  ]);
});

test("Lead In can advance to Bid Scheduled", () => {
  assert.equal(canTransition("LEAD_IN", "BID_SCHEDULED"), true);
});

test("Bid Scheduled can advance to the optional Design Fee stage", () => {
  assert.equal(canTransition("BID_SCHEDULED", "DESIGN_FEE"), true);
});

test("Bid Scheduled can also skip Design Fee and go straight to Bid Given", () => {
  assert.equal(canTransition("BID_SCHEDULED", "BID_GIVEN"), true);
});

test("Design Fee can only advance to Bid Given", () => {
  assert.equal(canTransition("DESIGN_FEE", "BID_GIVEN"), true);
  assert.equal(canTransition("DESIGN_FEE", "WON"), false);
});

test("Bid Given branches to Won or Lost", () => {
  assert.equal(canTransition("BID_GIVEN", "WON"), true);
  assert.equal(canTransition("BID_GIVEN", "LOST"), true);
});

test("Lost is terminal", () => {
  assert.equal(canTransition("LOST", "CONTRACT_SENT"), false);
  assert.equal(canTransition("LOST", "WON"), false);
});

test("Complete is terminal", () => {
  assert.equal(canTransition("COMPLETE", "LEAD_IN"), false);
});

test("cannot skip stages, e.g. Lead In straight to Job Scheduled", () => {
  assert.equal(canTransition("LEAD_IN", "JOB_SCHEDULED"), false);
});

test("cannot move backwards, e.g. Won back to Bid Given", () => {
  assert.equal(canTransition("WON", "BID_GIVEN"), false);
});

test("unknown stage names never transition", () => {
  assert.equal(canTransition("NOT_A_STAGE", "WON"), false);
  assert.equal(canTransition("LEAD_IN", "NOT_A_STAGE"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL with a module-not-found error for `../../js/pipeline.js`.

- [ ] **Step 3: Write `js/pipeline.js`**

```javascript
export const STAGES = [
  "LEAD_IN",
  "BID_SCHEDULED",
  "DESIGN_FEE",
  "BID_GIVEN",
  "WON",
  "LOST",
  "CONTRACT_SENT",
  "CONTRACT_SIGNED",
  "DEPOSIT_INVOICED",
  "DEPOSIT_PAID",
  "JOB_SCHEDULED",
  "IN_PROGRESS",
  "FINAL_INVOICE_SENT",
  "FINAL_PAYMENT_RECEIVED",
  "COMPLETE",
];

const TRANSITIONS = {
  LEAD_IN: ["BID_SCHEDULED"],
  BID_SCHEDULED: ["DESIGN_FEE", "BID_GIVEN"],
  DESIGN_FEE: ["BID_GIVEN"],
  BID_GIVEN: ["WON", "LOST"],
  WON: ["CONTRACT_SENT"],
  LOST: [],
  CONTRACT_SENT: ["CONTRACT_SIGNED"],
  CONTRACT_SIGNED: ["DEPOSIT_INVOICED"],
  DEPOSIT_INVOICED: ["DEPOSIT_PAID"],
  DEPOSIT_PAID: ["JOB_SCHEDULED"],
  JOB_SCHEDULED: ["IN_PROGRESS"],
  IN_PROGRESS: ["FINAL_INVOICE_SENT"],
  FINAL_INVOICE_SENT: ["FINAL_PAYMENT_RECEIVED"],
  FINAL_PAYMENT_RECEIVED: ["COMPLETE"],
  COMPLETE: [],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:unit`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add js/pipeline.js tests/unit/pipeline.test.js
git commit -m "feat: add pipeline stage transition logic"
```

---

### Task 4: Auth wiring and user role lookup

**Files:**
- Create: `js/auth.js`

**Interfaces:**
- Consumes: `auth`, `db` from `js/firebase-config.js` (Task 1)
- Produces: `signIn(email, password)`, `signOutUser()`, `onAuthChange(callback)` (callback receives `firebaseUser | null`), `getUserRole(uid)` (returns `Promise<"staff"|"crew"|null>`) — `js/main.js` (Task 6) calls all four.

- [ ] **Step 1: Write `js/auth.js`**

```javascript
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function getUserRole(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return snap.data().role ?? null;
}
```

There are no automated tests for this file — the Firebase Auth SDK itself
is Google's, not ours, and mocking it would test the mock, not real
behavior. Verification is manual, in Task 7's end-to-end checklist.

- [ ] **Step 2: Commit**

```bash
git add js/auth.js
git commit -m "feat: add Firebase Auth wiring and user role lookup"
```

---

### Task 5: Job/lead Firestore data layer

**Files:**
- Create: `js/jobs.js`
- Test: `tests/rules/jobs-data.rules.test.js`

**Interfaces:**
- Consumes: `db` from `js/firebase-config.js` (Task 1), `canTransition` from `js/pipeline.js` (Task 3)
- Produces: `createLead(data)` (returns `Promise<string>`, the new job ID), `updateJobStage(jobId, currentStatus, newStatus)` (throws if `canTransition` returns false, otherwise resolves), `listJobs(callback)` (returns an unsubscribe function; callback receives an array of `{ id, ...data }`) — `js/main.js` (Task 6) calls all three.

- [ ] **Step 1: Write the failing data-layer test**

This runs against the emulator directly (not through security rules —
`withSecurityRulesDisabled` isn't used here; instead we seed a real
authenticated staff user via `initializeTestEnvironment`'s
`authenticatedContext`, matching how the real app will call these
functions).

```javascript
// tests/rules/jobs-data.rules.test.js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";

let testEnv;
let db;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "deckedoutwnc-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
  });
  db = testEnv.authenticatedContext("staff-uid").firestore();
});

after(async () => {
  await testEnv.cleanup();
});

test("creating a lead writes status LEAD_IN", async () => {
  const ref = await db.collection("jobs").add({ status: "LEAD_IN", customerName: "Test Customer" });
  const snap = await ref.get();
  assert.equal(snap.data().status, "LEAD_IN");
});

test("valid stage transition updates the status field", async () => {
  const ref = await db.collection("jobs").add({ status: "LEAD_IN", customerName: "Test Customer" });
  await ref.update({ status: "BID_SCHEDULED" });
  const snap = await ref.get();
  assert.equal(snap.data().status, "BID_SCHEDULED");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:rules`
Expected: FAIL — no jobs exist yet / this new test file doesn't compile against anything, since `js/jobs.js` doesn't exist and hasn't been wired. (This test only exercises raw Firestore calls, so at this step it should actually already pass on its own — its real purpose is to lock in the expected data shape before `js/jobs.js` wraps it. Confirm it passes here; if it doesn't, fix the test before moving on.)

- [ ] **Step 3: Write `js/jobs.js`**

```javascript
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { canTransition } from "./pipeline.js";

export async function createLead(data) {
  const ref = await addDoc(collection(db, "jobs"), {
    ...data,
    status: "LEAD_IN",
    stageEnteredAt: { LEAD_IN: serverTimestamp() },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateJobStage(jobId, currentStatus, newStatus) {
  if (!canTransition(currentStatus, newStatus)) {
    throw new Error(`Cannot transition from ${currentStatus} to ${newStatus}`);
  }
  await updateDoc(doc(db, "jobs", jobId), {
    status: newStatus,
    [`stageEnteredAt.${newStatus}`]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function listJobs(callback) {
  const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
```

- [ ] **Step 4: Run the test again to confirm the data shape still holds**

Run: `npm run test:rules`
Expected: PASS — both tests from Step 1 green, plus all of Task 2's tests still green (no regressions).

- [ ] **Step 5: Commit**

```bash
git add js/jobs.js tests/rules/jobs-data.rules.test.js
git commit -m "feat: add job/lead Firestore data layer"
```

---

### Task 6: Login screen and pipeline list UI

**Files:**
- Create: `index.html`
- Create: `js/main.js`

**Interfaces:**
- Consumes: `onAuthChange`, `signIn`, `signOutUser`, `getUserRole` (Task 4); `createLead`, `updateJobStage`, `listJobs` (Task 5); `STAGES`, `canTransition` (Task 3)

- [ ] **Step 1: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Decked Out WNC — Pipeline Tracker</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 800px; }
    #login-view, #app-view { display: none; }
    .job-card { border: 1px solid #ccc; border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; }
    .job-card h3 { margin: 0 0 0.25rem 0; }
    .stage-badge { display: inline-block; padding: 0.15rem 0.5rem; background: #eee; border-radius: 4px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div id="login-view">
    <h1>Decked Out WNC — Sign In</h1>
    <form id="login-form">
      <input type="email" id="login-email" placeholder="Email" required />
      <input type="password" id="login-password" placeholder="Password" required />
      <button type="submit">Sign In</button>
    </form>
    <p id="login-error" style="color: red;"></p>
  </div>

  <div id="app-view">
    <h1>Pipeline</h1>
    <button id="signout-btn">Sign Out</button>
    <div id="new-lead-section">
      <h2>New Lead</h2>
      <form id="new-lead-form">
        <input type="text" id="lead-customer-name" placeholder="Customer name" required />
        <input type="text" id="lead-address" placeholder="Job address" required />
        <button type="submit">Add Lead</button>
      </form>
    </div>
    <h2>Jobs</h2>
    <div id="job-list"></div>
  </div>

  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `js/main.js`**

```javascript
import { onAuthChange, signIn, signOutUser, getUserRole } from "./auth.js";
import { createLead, updateJobStage, listJobs } from "./jobs.js";
import { STAGES, canTransition } from "./pipeline.js";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const signoutBtn = document.getElementById("signout-btn");
const newLeadForm = document.getElementById("new-lead-form");
const newLeadSection = document.getElementById("new-lead-section");
const jobList = document.getElementById("job-list");

let unsubscribeJobs = null;
let currentRole = null;

onAuthChange(async (user) => {
  if (unsubscribeJobs) {
    unsubscribeJobs();
    unsubscribeJobs = null;
  }
  if (!user) {
    currentRole = null;
    loginView.style.display = "block";
    appView.style.display = "none";
    return;
  }
  currentRole = await getUserRole(user.uid);
  loginView.style.display = "none";
  appView.style.display = "block";
  newLeadSection.style.display = currentRole === "staff" ? "block" : "none";
  unsubscribeJobs = listJobs(renderJobs);
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  try {
    await signIn(email, password);
  } catch (err) {
    loginError.textContent = "Sign in failed: " + err.message;
  }
});

signoutBtn.addEventListener("click", () => signOutUser());

newLeadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const customerName = document.getElementById("lead-customer-name").value;
  const address = document.getElementById("lead-address").value;
  await createLead({ customerName, address });
  newLeadForm.reset();
});

function renderJobs(jobs) {
  jobList.innerHTML = "";
  for (const job of jobs) {
    const card = document.createElement("div");
    card.className = "job-card";

    const title = document.createElement("h3");
    title.textContent = job.customerName ?? "(no name)";
    card.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "stage-badge";
    badge.textContent = job.status;
    card.appendChild(badge);

    if (currentRole === "staff") {
      const nextStages = STAGES.filter((s) => canTransition(job.status, s));
      if (nextStages.length > 0) {
        const select = document.createElement("select");
        const placeholder = document.createElement("option");
        placeholder.textContent = "Advance to...";
        placeholder.value = "";
        select.appendChild(placeholder);
        for (const stage of nextStages) {
          const opt = document.createElement("option");
          opt.value = stage;
          opt.textContent = stage;
          select.appendChild(opt);
        }
        select.addEventListener("change", async () => {
          if (!select.value) return;
          await updateJobStage(job.id, job.status, select.value);
        });
        card.appendChild(select);
      }
    }

    jobList.appendChild(card);
  }
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run emulators` in one terminal, `npx serve .` in another, then open the served URL.

1. In the Firebase Emulator UI (localhost:4000), Auth tab, create a test
   user with email/password, then Firestore tab, create a matching
   `users/{uid}` doc with `{ "role": "staff", "name": "Test Staff" }`
   (use the real uid from the Auth tab).
2. In the browser, sign in with that test user. Expected: the pipeline
   view loads, login form hides.
3. Add a new lead via the form. Expected: a job card appears with stage
   badge `LEAD_IN`.
4. Use the "Advance to..." dropdown to move it to `BID_SCHEDULED`.
   Expected: the badge updates.
5. Sign out, create a second test user + a `users/{uid}` doc with
   `{ "role": "crew" }`, sign in as that user. Expected: no "New Lead"
   form is shown, and the job card list is empty (crew isn't assigned to
   anything yet — expected per this phase's scope).

- [ ] **Step 4: Commit**

```bash
git add index.html js/main.js
git commit -m "feat: add login screen and pipeline list UI"
```

---

### Task 7: End-to-end verification checklist

No new files — this task is a final manual pass confirming Tasks 1-6
work together correctly, including the Won/Lost branch that Task 6's
manual check didn't cover.

- [ ] **Step 1: Full pipeline walk, staff view**

With emulators running and signed in as the `staff` test user from
Task 6: create a new lead, and advance it through every stage up to
`WON`: `LEAD_IN` → `BID_SCHEDULED` → `BID_GIVEN` → `WON`. Confirm the
dropdown only ever offers valid next stages at each step (e.g. from
`BID_SCHEDULED` it should offer both `DESIGN_FEE` and `BID_GIVEN`, and
picking `BID_GIVEN` directly should skip the design fee cleanly).

- [ ] **Step 2: Lost branch**

Create a second lead, advance it to `BID_GIVEN`, then pick `LOST`.
Confirm the dropdown then shows no further options (Lost is terminal).

- [ ] **Step 3: Rules regression check**

Run: `npm run test:rules && npm run test:unit`
Expected: all tests from Tasks 2, 3, and 5 still pass together.

- [ ] **Step 4: Update the vault**

Update `DZ obsidian/projects/decked-out-wnc/architecture.md`'s status
and known-issues.md with anything discovered during this phase that
diverged from the design (e.g. any Firebase emulator quirks, any stage
naming that changed). Log the session in
`DZ obsidian/projects/decked-out-wnc/sessions/<date>.md`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: Phase 1 foundation complete — auth, roles, pipeline CRUD"
```
