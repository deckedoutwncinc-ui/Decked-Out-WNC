# Decked Out WNC — Phase 6: Materials Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Grayson (staff) attach a materials receipt (photo/PDF + amount/vendor/date) to a specific job from his phone, and let Layla see a running materials total per job — via a new Job Detail page.

**Architecture:** Extends the Phase 1 foundation. Adds Firebase Storage (first use in this app) for receipt files, a new staff-only `jobs/{jobId}/receipts` Firestore subcollection, and a Job Detail view within the existing single-page app (no new HTML file, no build step).

**Tech Stack:** Same as Phase 1 — Firebase modular JS SDK v10 via CDN ESM imports, Firebase Local Emulator Suite (now including the Storage emulator), `@firebase/rules-unit-testing` for both Firestore and Storage rules tests, Node's built-in `node:test`.

**Spec:** `DZ obsidian/projects/decked-out-wnc/architecture.md`'s "Materials receipts (Phase 6)" section (see also `decisions.md`'s "Materials receipts: brainstorming decisions" entry)

## Global Constraints

- No build step — plain ES modules, Firebase SDK via CDN, same as Phase 1.
- Grayson uses the existing `staff` role — no new role/permission tier. Receipts are staff-only read/write (financial data), enforced in both Firestore rules AND Storage rules.
- Must be fully demoable via the local emulator suite alone — no requirement to push to GitHub or deploy to Cloudflare/production Firebase to show this working. (Daniel wants to show Grayson and Layla a local demo before committing further.)
- Dates in the UI display as MM/DD/YYYY (Daniel's standing convention).
- Firestore project ID is `deckedoutwnc`; the Storage bucket is `deckedoutwnc.firebasestorage.app` (from the existing `js/firebase-config.js`).

---

### Task 1: Firebase config and emulator wiring for Storage

**Files:**
- Modify: `firebase.json`
- Create: `storage.rules`
- Modify: `js/firebase-config.js`

**Interfaces:**
- Produces: `js/firebase-config.js` now also exports `storage` (an initialized Firebase Storage instance) — Task 3's `js/receipts.js` imports it.

- [ ] **Step 1: Add a default-deny `storage.rules`**

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 2: Update `firebase.json`**

Add a `storage` key alongside the existing `firestore` key, and a `storage` emulator entry:

```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

- [ ] **Step 3: Update `js/firebase-config.js`**

Add the Storage SDK import and emulator connection, alongside the existing Auth/Firestore ones:

```javascript
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

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
export const storage = getStorage(app);

if (
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
```

- [ ] **Step 4: Verify the emulators start with Storage included**

Run (with Java on PATH — see README): `npm run emulators`
Expected: log shows Auth, Firestore, AND Storage emulators all ready, no errors. Stop with Ctrl+C.

Note: `npm run emulators` currently only starts `--only firestore,auth` (see `package.json`). Update that script to `firebase emulators:start --only firestore,auth,storage` so Storage starts too.

- [ ] **Step 5: Commit**

```bash
git add firebase.json storage.rules js/firebase-config.js package.json
git commit -m "chore: wire Firebase Storage emulator into the project"
```

---

### Task 2: Security rules for receipts (Firestore + Storage), TDD

**Files:**
- Modify: `firestore.rules`
- Modify: `storage.rules`
- Test: `tests/rules/receipts.rules.test.js`

**Interfaces:**
- Produces: the security rules every read/write of a receipt (Firestore doc or Storage file) must satisfy. Receipts are staff-only, full stop — no crew access path at all, unlike jobs' `isAssignedCrew()`.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/rules/receipts.rules.test.js
import { test, before, beforeEach, after } from "node:test";
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
    storage: {
      rules: fs.readFileSync("storage.rules", "utf8"),
      host: "127.0.0.1",
      port: 9199,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
    await db.collection("users").doc("crew-uid").set({ role: "crew", name: "Crew Person" });
    await db.collection("jobs").doc("job-1").set({ status: "JOB_SCHEDULED", customerName: "A" });
  });
});

after(async () => {
  await testEnv.cleanup();
});

function staffCtx() {
  return testEnv.authenticatedContext("staff-uid");
}
function crewCtx() {
  return testEnv.authenticatedContext("crew-uid");
}
function anonCtx() {
  return testEnv.unauthenticatedContext();
}

test("staff can create a receipt on a job", async () => {
  const db = staffCtx().firestore();
  await assertSucceeds(
    db.collection("jobs").doc("job-1").collection("receipts").add({
      amount: 42.5,
      vendor: "Home Depot",
      date: "2026-09-05",
      fileUrl: "https://example.com/receipt.jpg",
      uploadedBy: "staff-uid",
    })
  );
});

test("staff can read receipts on a job", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-1").collection("receipts").doc("r1").set({
      amount: 10, vendor: "V", date: "2026-09-05", fileUrl: "x", uploadedBy: "staff-uid",
    });
  });
  const db = staffCtx().firestore();
  await assertSucceeds(db.collection("jobs").doc("job-1").collection("receipts").doc("r1").get());
});

test("crew cannot create a receipt", async () => {
  const db = crewCtx().firestore();
  await assertFails(
    db.collection("jobs").doc("job-1").collection("receipts").add({
      amount: 42.5, vendor: "Home Depot", date: "2026-09-05", fileUrl: "x", uploadedBy: "crew-uid",
    })
  );
});

test("crew cannot read receipts, even single-document get", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-1").collection("receipts").doc("r1").set({
      amount: 10, vendor: "V", date: "2026-09-05", fileUrl: "x", uploadedBy: "staff-uid",
    });
  });
  const db = crewCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-1").collection("receipts").doc("r1").get());
});

test("unauthenticated user cannot read or write receipts", async () => {
  const db = anonCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-1").collection("receipts").doc("r1").get());
  await assertFails(
    db.collection("jobs").doc("job-1").collection("receipts").add({ amount: 1, vendor: "x", date: "x", fileUrl: "x", uploadedBy: "x" })
  );
});

test("staff can upload a receipt file to Storage", async () => {
  const storage = staffCtx().storage();
  const bytes = new Uint8Array([1, 2, 3]);
  await assertSucceeds(
    storage.ref("jobs/job-1/receipts/test.jpg").put(bytes, { contentType: "image/jpeg" })
  );
});

test("crew cannot upload a receipt file to Storage", async () => {
  const storage = crewCtx().storage();
  const bytes = new Uint8Array([1, 2, 3]);
  await assertFails(
    storage.ref("jobs/job-1/receipts/test.jpg").put(bytes, { contentType: "image/jpeg" })
  );
});

test("unauthenticated user cannot upload a receipt file", async () => {
  const storage = anonCtx().storage();
  const bytes = new Uint8Array([1, 2, 3]);
  await assertFails(
    storage.ref("jobs/job-1/receipts/test.jpg").put(bytes, { contentType: "image/jpeg" })
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:rules` (Java exported first)
Expected: FAIL — `storage.rules` is still default-deny (Task 1), and `firestore.rules` has no `receipts` subcollection rule yet, so both the "staff can ..." tests fail (should succeed but don't) while the "crew/unauthenticated cannot ..." tests may already incidentally pass (default-deny denies everyone). The meaningful RED signal is the staff-success assertions failing.

- [ ] **Step 3: Add the Firestore rule**

In `firestore.rules`, add a new match block (after the existing `match /jobs/{jobId} { ... }` block, same nesting level):

```
    match /jobs/{jobId}/receipts/{receiptId} {
      allow read, write: if isStaff();
    }
```

- [ ] **Step 4: Write `storage.rules`**

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isStaff() {
      return request.auth != null &&
        firestore.exists(/databases/(default)/documents/users/$(request.auth.uid)) &&
        firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.role == 'staff';
    }

    match /jobs/{jobId}/receipts/{fileName} {
      allow read, write: if isStaff();
    }

    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS — all 8 new tests green, plus the existing 14 tests from Phase 1 still green (22 total in the rules suite).

- [ ] **Step 6: Commit**

```bash
git add firestore.rules storage.rules tests/rules/receipts.rules.test.js
git commit -m "feat: add staff-only security rules for materials receipts"
```

---

### Task 3: Receipts data layer (Firestore + Storage upload)

**Files:**
- Create: `js/receipts.js`
- Test: `tests/rules/receipts-data.rules.test.js`

**Interfaces:**
- Consumes: `db`, `storage`, `auth` from `js/firebase-config.js` (Task 1)
- Produces: `uploadReceipt(jobId, { amount, vendor, date, file })` (returns `Promise<string>`, the new receipt doc's ID — uploads the file to Storage first, then writes the Firestore doc with the resulting download URL), `listReceipts(jobId, callback)` (returns an unsubscribe function; callback receives an array of `{ id, ...data }` ordered by `date` descending) — Task 4's `js/main.js` calls both.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/rules/receipts-data.rules.test.js
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

let testEnv;
let db;
let storage;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "deckedoutwnc-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
    storage: {
      rules: fs.readFileSync("storage.rules", "utf8"),
      host: "127.0.0.1",
      port: 9199,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
    await ctx.firestore().collection("jobs").doc("job-1").set({ status: "JOB_SCHEDULED", customerName: "A" });
  });
  const ctx = testEnv.authenticatedContext("staff-uid");
  db = ctx.firestore();
  storage = ctx.storage();
});

after(async () => {
  await testEnv.cleanup();
});

test("uploading a receipt file writes bytes retrievable from Storage", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fileRef = storage.ref("jobs/job-1/receipts/test-upload.jpg");
  await fileRef.put(bytes, { contentType: "image/jpeg" });
  const url = await fileRef.getDownloadURL();
  assert.equal(typeof url, "string");
  assert.ok(url.length > 0);
});

test("creating a receipt doc stores amount, vendor, date, fileUrl, uploadedBy", async () => {
  const ref = await db.collection("jobs").doc("job-1").collection("receipts").add({
    amount: 88.5,
    vendor: "Lowe's",
    date: "2026-09-05",
    fileUrl: "https://example.com/fake.jpg",
    uploadedBy: "staff-uid",
  });
  const snap = await ref.get();
  const data = snap.data();
  assert.equal(data.amount, 88.5);
  assert.equal(data.vendor, "Lowe's");
  assert.equal(data.fileUrl, "https://example.com/fake.jpg");
  assert.equal(data.uploadedBy, "staff-uid");
});
```

- [ ] **Step 2: Run the test to verify it passes as raw Firestore/Storage calls**

Run: `npm run test:rules`
Expected: PASS (this test only locks in the expected shape via raw SDK calls, same reasoning as Phase 1's `jobs-data.rules.test.js` — it should already pass here since Task 2 already made the rules permit this).

- [ ] **Step 3: Write `js/receipts.js`**

```javascript
import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { db, storage, auth } from "./firebase-config.js";

export async function uploadReceipt(jobId, { amount, vendor, date, file }) {
  const path = `jobs/${jobId}/receipts/${Date.now()}_${file.name}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  const fileUrl = await getDownloadURL(fileRef);

  const docRef = await addDoc(collection(db, "jobs", jobId, "receipts"), {
    amount: Number(amount),
    vendor,
    date,
    fileUrl,
    uploadedBy: auth.currentUser.uid,
    uploadedAt: serverTimestamp(),
  });
  return docRef.id;
}

export function listReceipts(jobId, callback) {
  const q = query(
    collection(db, "jobs", jobId, "receipts"),
    orderBy("date", "desc")
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      console.error("listReceipts snapshot error:", error);
      callback([]);
    }
  );
}
```

- [ ] **Step 4: Run the tests again to confirm nothing regressed**

Run: `npm run test:rules`
Expected: PASS — all tests from Tasks 2 and 3 green, plus Phase 1's existing rules tests still green.

- [ ] **Step 5: Commit**

```bash
git add js/receipts.js tests/rules/receipts-data.rules.test.js
git commit -m "feat: add receipts data layer (Storage upload + Firestore doc)"
```

---

### Task 4: Job Detail page UI

**Files:**
- Modify: `index.html`
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `uploadReceipt`, `listReceipts` (Task 3); existing `STAGES`, `canTransition` (Phase 1); existing `createLead`, `updateJobStage`, `listJobs` (Phase 1)

- [ ] **Step 1: Add the Job Detail markup to `index.html`**

Inside `<div id="app-view">`, wrap the existing "New Lead" + "Jobs" markup in a new `<div id="pipeline-section">`, and add a sibling `<div id="job-detail-section" hidden>` after it:

```html
  <div id="app-view">
    <h1>Pipeline</h1>
    <button id="signout-btn">Sign Out</button>
    <p id="app-error" style="color: red;"></p>

    <div id="pipeline-section">
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

    <div id="job-detail-section" hidden>
      <button id="back-to-list-btn">&larr; Back to Pipeline</button>
      <h2 id="job-detail-title"></h2>
      <p id="job-detail-status" class="stage-badge"></p>

      <div id="receipts-section">
        <h3>Materials Receipts</h3>
        <p id="receipts-total"></p>
        <div id="receipts-list"></div>
        <h4>Add Receipt</h4>
        <form id="add-receipt-form">
          <input type="number" id="receipt-amount" placeholder="Amount" step="0.01" min="0" required />
          <input type="text" id="receipt-vendor" placeholder="Vendor" required />
          <input type="date" id="receipt-date" required />
          <input type="file" id="receipt-file" accept="image/*,application/pdf" capture="environment" required />
          <button type="submit">Add Receipt</button>
        </form>
      </div>
      <p id="receipts-staff-only-notice" hidden>Materials receipts are only visible to staff.</p>
    </div>
  </div>
```

- [ ] **Step 2: Add a "View Details" button to each job card in `renderJobs`**

In `js/main.js`, inside `renderJobs`, after the stage badge is appended to `card`, add:

```javascript
    const detailBtn = document.createElement("button");
    detailBtn.textContent = "View Details";
    detailBtn.addEventListener("click", () => openJobDetail(job));
    card.appendChild(detailBtn);
```

- [ ] **Step 3: Add the Job Detail view logic to `js/main.js`**

Add these imports at the top:

```javascript
import { uploadReceipt, listReceipts } from "./receipts.js";
```

Add these element references near the existing ones:

```javascript
const pipelineSection = document.getElementById("pipeline-section");
const jobDetailSection = document.getElementById("job-detail-section");
const jobDetailTitle = document.getElementById("job-detail-title");
const jobDetailStatus = document.getElementById("job-detail-status");
const backToListBtn = document.getElementById("back-to-list-btn");
const receiptsSection = document.getElementById("receipts-section");
const receiptsStaffOnlyNotice = document.getElementById("receipts-staff-only-notice");
const receiptsTotal = document.getElementById("receipts-total");
const receiptsList = document.getElementById("receipts-list");
const addReceiptForm = document.getElementById("add-receipt-form");
```

Add this state variable near `currentRole`:

```javascript
let unsubscribeReceipts = null;
let currentJobId = null;
```

Add the view-switching and rendering functions (place after `renderJobs`):

```javascript
function openJobDetail(job) {
  currentJobId = job.id;
  pipelineSection.hidden = true;
  jobDetailSection.hidden = false;
  jobDetailTitle.textContent = job.customerName ?? "(no name)";
  jobDetailStatus.textContent = job.status;

  if (currentRole === "staff") {
    receiptsSection.hidden = false;
    receiptsStaffOnlyNotice.hidden = true;
    if (unsubscribeReceipts) unsubscribeReceipts();
    unsubscribeReceipts = listReceipts(currentJobId, renderReceipts);
  } else {
    receiptsSection.hidden = true;
    receiptsStaffOnlyNotice.hidden = false;
  }
}

function closeJobDetail() {
  if (unsubscribeReceipts) {
    unsubscribeReceipts();
    unsubscribeReceipts = null;
  }
  currentJobId = null;
  jobDetailSection.hidden = true;
  pipelineSection.hidden = false;
}

function renderReceipts(receipts) {
  receiptsList.innerHTML = "";
  let total = 0;
  for (const receipt of receipts) {
    total += receipt.amount ?? 0;
    const row = document.createElement("div");
    row.className = "receipt-row";
    row.textContent = `${receipt.date} — ${receipt.vendor} — $${receipt.amount.toFixed(2)}`;
    const link = document.createElement("a");
    link.href = receipt.fileUrl;
    link.target = "_blank";
    link.textContent = " (view)";
    row.appendChild(link);
    receiptsList.appendChild(row);
  }
  receiptsTotal.textContent = `Total: $${total.toFixed(2)}`;
}
```

Add the event listeners (place near the other `addEventListener` calls):

```javascript
backToListBtn.addEventListener("click", closeJobDetail);

addReceiptForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  appError.textContent = "";
  const amount = document.getElementById("receipt-amount").value;
  const vendor = document.getElementById("receipt-vendor").value;
  const date = document.getElementById("receipt-date").value;
  const file = document.getElementById("receipt-file").files[0];
  try {
    await uploadReceipt(currentJobId, { amount, vendor, date, file });
    addReceiptForm.reset();
  } catch (err) {
    appError.textContent = "Could not add receipt: " + err.message;
  }
});
```

Finally, update `onAuthChange`'s sign-out path (the `if (!user)` branch) to also reset the job-detail view, so signing out while viewing a job detail doesn't leave stale state:

```javascript
  if (!user) {
    currentRole = null;
    closeJobDetail();
    loginView.style.display = "block";
    appView.style.display = "none";
    return;
  }
```

- [ ] **Step 4: Manual verification**

With emulators running (`npm run emulators`, Java exported) and the app served (`npx serve .`):

1. Sign in as the staff test user from Phase 1's verification.
2. Click "View Details" on a job. Expected: pipeline section hides, job detail section shows with the job's name and status, an empty receipts list, and "Total: $0.00".
3. Fill in the Add Receipt form (amount, vendor, date, and pick any small image file) and submit. Expected: the receipt appears in the list, the total updates, and the form resets.
4. Click "Back to Pipeline". Expected: returns to the job list, no console errors.
5. Sign out, sign in as the crew test user, click "View Details" on any job crew can see (likely none yet, per Phase 1/4 status — if crew's job list is empty, skip this specific check and instead verify via `js/receipts.js`'s security rules tests from Task 2, which already cover crew denial directly).

- [ ] **Step 5: Commit**

```bash
git add index.html js/main.js
git commit -m "feat: add Job Detail page with materials receipts"
```

---

### Task 5: End-to-end verification and vault update

No new files — a final manual pass plus documentation.

- [ ] **Step 1: Full receipt walk**

With emulators + served app running, signed in as staff: open a job, add two receipts with different amounts, confirm the running total is their sum, confirm both appear in the list sorted by date, and confirm each "(view)" link opens the uploaded file.

- [ ] **Step 2: Rules regression check**

Run: `npm run test:unit && npm run test:rules`
Expected: all tests from Phase 1 and Phase 6 pass together.

- [ ] **Step 3: Update the vault**

Update `DZ obsidian/projects/decked-out-wnc/architecture.md`'s status line to reflect Phase 6 as built, and log the session in
`DZ obsidian/projects/decked-out-wnc/sessions/<date>.md`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 6 materials receipts complete"
```
