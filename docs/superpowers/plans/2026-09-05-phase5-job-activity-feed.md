# Decked Out WNC — Phase 5: Job-Site Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let both `staff` and assigned `crew` post updates (a photo, a text note, or both together) to a job's chronological activity feed, and read the feed for jobs they can access.

**Architecture:** Extends Phase 1/6's foundation. Adds a new `jobs/{jobId}/activity` Firestore subcollection (the first place `crew` gets Firestore write access at all in this app) and reuses Storage + the independent photo-capture UI pattern already established for receipts. No new emulator/config wiring needed — Firestore, Auth, and Storage emulators are already set up from Phase 6.

**Tech Stack:** Same as Phase 1/6 — Firebase modular JS SDK v10 via CDN ESM imports, Firebase Local Emulator Suite, `@firebase/rules-unit-testing`, Node's built-in `node:test`.

**Spec:** `DZ obsidian/projects/decked-out-wnc/architecture.md`'s "Job-site activity feed (Phase 5)" section (see also `decisions.md`'s "Job-site activity feed: brainstorming decisions" entry)

## Global Constraints

- No build step — plain ES modules via CDN, no bundler.
- Visibility differs from receipts: both `staff` and **assigned `crew`** can read and post; only `staff` can delete. No one can edit an existing entry (append-only, matching `jobs/{jobId}/history`'s audit-trail precedent).
- An entry needs at least one of `text` or `photoUrl` — enforced client-side only (no server-side field validation), matching every other collection's existing pattern in this app (permission rules only, no schema rules).
- Crew's Firestore role check depends on the *parent job's* `assignedCrew` field via a `get()` keyed on the fixed `jobId` path segment — this is a **known-risk pattern to verify empirically**: Phase 1 hit a real Firestore limitation where a rule needing per-document `resource.data` breaks an unconstrained `list` query. This case is different (the join is on a path parameter constant across the whole subcollection, not on `resource.data` of each activity entry), but Task 1 must prove this with a real `list`-query test against the emulator before anything else is built on top of it — do not assume it works from reasoning alone.
- Firestore project ID `deckedoutwnc`; rules tests use `deckedoutwnc-test` with the `--project deckedoutwnc-test` pin already in `package.json`'s `test:rules` script (required for Storage's cross-service Firestore checks — do not remove it).
- Dates/timestamps in the UI display as MM/DD/YYYY (Daniel's standing convention) — reuse the existing `formatDateMDY` helper in `js/main.js` if a date needs displaying (this phase primarily uses `createdAt` timestamps, not a date-only field like receipts — see Task 3 for exact display format).

---

### Task 1: Security rules for the activity feed (Firestore + Storage), TDD

**Files:**
- Modify: `firestore.rules`
- Modify: `storage.rules`
- Test: `tests/rules/activity.rules.test.js`

**Interfaces:**
- Produces: the security rules every read/write of an activity entry (Firestore doc) or its photo (Storage file) must satisfy.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/rules/activity.rules.test.js
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
    const setupDb = ctx.firestore();
    await setupDb.collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
    await setupDb.collection("users").doc("crew-uid").set({ role: "crew", name: "Crew Person" });
    await setupDb.collection("jobs").doc("job-unassigned").set({ status: "JOB_SCHEDULED", customerName: "A" });
    await setupDb.collection("jobs").doc("job-assigned").set({
      status: "JOB_SCHEDULED",
      customerName: "B",
      assignedCrew: ["crew-uid"],
    });
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

test("staff can create an activity entry on any job", async () => {
  const db = staffCtx().firestore();
  await assertSucceeds(
    db.collection("jobs").doc("job-unassigned").collection("activity").add({
      text: "Started demo today", photoUrl: null, authorUid: "staff-uid", authorEmail: "staff@test.local",
    })
  );
});

test("crew cannot create an activity entry on a job they are not assigned to", async () => {
  const db = crewCtx().firestore();
  await assertFails(
    db.collection("jobs").doc("job-unassigned").collection("activity").add({
      text: "hi", photoUrl: null, authorUid: "crew-uid", authorEmail: "crew@test.local",
    })
  );
});

test("crew CAN create an activity entry on a job they are assigned to", async () => {
  const db = crewCtx().firestore();
  await assertSucceeds(
    db.collection("jobs").doc("job-assigned").collection("activity").add({
      text: "Framing done", photoUrl: null, authorUid: "crew-uid", authorEmail: "crew@test.local",
    })
  );
});

test("crew cannot read activity on a job they are not assigned to", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-unassigned").collection("activity").doc("e1").set({
      text: "x", authorUid: "staff-uid",
    });
  });
  const db = crewCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-unassigned").collection("activity").doc("e1").get());
});

test("crew CAN read a single activity entry on a job they are assigned to", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-assigned").collection("activity").doc("e1").set({
      text: "x", authorUid: "staff-uid",
    });
  });
  const db = crewCtx().firestore();
  await assertSucceeds(db.collection("jobs").doc("job-assigned").collection("activity").doc("e1").get());
});

test("crew CAN list the full activity feed on a job they are assigned to (the known-risk case)", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const setupDb = ctx.firestore();
    await setupDb.collection("jobs").doc("job-assigned").collection("activity").doc("e1").set({ text: "one", authorUid: "staff-uid" });
    await setupDb.collection("jobs").doc("job-assigned").collection("activity").doc("e2").set({ text: "two", authorUid: "crew-uid" });
  });
  const db = crewCtx().firestore();
  const snap = await assertSucceeds(db.collection("jobs").doc("job-assigned").collection("activity").get());
  assert.equal(snap.docs.length, 2);
});

test("crew cannot update an existing activity entry, even one they authored", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-assigned").collection("activity").doc("e1").set({
      text: "original", authorUid: "crew-uid",
    });
  });
  const db = crewCtx().firestore();
  await assertFails(
    db.collection("jobs").doc("job-assigned").collection("activity").doc("e1").update({ text: "edited" })
  );
});

test("crew cannot delete an activity entry", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-assigned").collection("activity").doc("e1").set({ text: "x" });
  });
  const db = crewCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-assigned").collection("activity").doc("e1").delete());
});

test("staff CAN delete an activity entry", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-assigned").collection("activity").doc("e1").set({ text: "x" });
  });
  const db = staffCtx().firestore();
  await assertSucceeds(db.collection("jobs").doc("job-assigned").collection("activity").doc("e1").delete());
});

test("unauthenticated user cannot read or write activity", async () => {
  const db = anonCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-assigned").collection("activity").get());
  await assertFails(db.collection("jobs").doc("job-assigned").collection("activity").add({ text: "x" }));
});

test("staff can upload an activity photo for any job", async () => {
  const storage = staffCtx().storage();
  const bytes = new Uint8Array([1, 2, 3]);
  await assertSucceeds(
    storage.ref("jobs/job-unassigned/activity/test.jpg").put(bytes, { contentType: "image/jpeg" })
  );
});

test("crew assigned to a job can upload an activity photo for it", async () => {
  const storage = crewCtx().storage();
  const bytes = new Uint8Array([1, 2, 3]);
  await assertSucceeds(
    storage.ref("jobs/job-assigned/activity/test.jpg").put(bytes, { contentType: "image/jpeg" })
  );
});

test("crew not assigned to a job cannot upload an activity photo for it", async () => {
  const storage = crewCtx().storage();
  const bytes = new Uint8Array([1, 2, 3]);
  await assertFails(
    storage.ref("jobs/job-unassigned/activity/test.jpg").put(bytes, { contentType: "image/jpeg" })
  );
});

test("activity photo upload rejects a file larger than 15MB", async () => {
  const storage = staffCtx().storage();
  const bytes = new Uint8Array(16 * 1024 * 1024);
  await assertFails(
    storage.ref("jobs/job-unassigned/activity/big.jpg").put(bytes, { contentType: "image/jpeg" })
  );
});

test("activity photo upload rejects a non-image content type", async () => {
  const storage = staffCtx().storage();
  const bytes = new Uint8Array([1, 2, 3]);
  await assertFails(
    storage.ref("jobs/job-unassigned/activity/doc.pdf").put(bytes, { contentType: "application/pdf" })
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (Java exported first: `export JAVA_HOME="/c/Program Files/Java/jdk-21.0.12" && export PATH="$JAVA_HOME/bin:$PATH"`): `npm run test:rules`
Expected: FAIL — no `jobs/{jobId}/activity` rule exists in `firestore.rules` yet (falls through to implicit deny), and no `jobs/{jobId}/activity/{fileName}` rule exists in `storage.rules` yet (falls through to the `{allPaths=**}` deny-all).

- [ ] **Step 3: Add the Firestore rule**

In `firestore.rules`, add a new match block after the existing `jobs/{jobId}/receipts/{receiptId}` block, at the same nesting level:

```
    match /jobs/{jobId}/activity/{entryId} {
      function isAssignedToJob() {
        return isCrew() &&
          request.auth.uid in get(/databases/$(database)/documents/jobs/$(jobId)).data.get('assignedCrew', []);
      }
      allow read, create: if isStaff() || isAssignedToJob();
      allow update: if false;
      allow delete: if isStaff();
    }
```

- [ ] **Step 4: Add the Storage rule**

In `storage.rules`, add an `isCrew()` helper next to the existing `isStaff()` function, and a new match block after the existing `jobs/{jobId}/receipts/{fileName}` block:

```
    function isCrew() {
      return request.auth != null &&
        firestore.exists(/databases/(default)/documents/users/$(request.auth.uid)) &&
        firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.get('role', '') == 'crew';
    }
    function isAssignedToJob(jobId) {
      return isCrew() &&
        request.auth.uid in firestore.get(/databases/(default)/documents/jobs/$(jobId)).data.get('assignedCrew', []);
    }

    match /jobs/{jobId}/activity/{fileName} {
      allow read: if isStaff() || isAssignedToJob(jobId);
      allow write: if (isStaff() || isAssignedToJob(jobId))
        && request.resource.size < 15 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
```

(Place this new function/match block above the existing `match /jobs/{jobId}/receipts/{fileName}` block or below it — either is fine; just keep it inside `match /b/{bucket}/o { ... }` alongside the existing content, before the `{allPaths=**}` deny-all fallback.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS — all 15 new tests green, especially the "crew CAN list the full activity feed" test (the known-risk case named in Global Constraints) — if this one fails with an evaluation error rather than a clean result, STOP and report back rather than trying to work around it; it means the path-parameter-vs-resource.data distinction this plan relied on doesn't hold and the design needs to change. Also confirm all pre-existing tests from Phases 1/6 still pass (24 + 15 = 39 total in the rules suite... wait, Phase 6 already added tests bringing the total to 29 — so 29 + 15 = 44 total. Confirm the actual printed count matches what's really in the test files, not this arithmetic, the same way earlier phases caught arithmetic mistakes here).

- [ ] **Step 6: Commit**

```bash
git add firestore.rules storage.rules tests/rules/activity.rules.test.js
git commit -m "feat: add security rules for the job-site activity feed"
```

---

### Task 2: Activity feed data layer

**Files:**
- Create: `js/activity.js`
- Test: `tests/rules/activity-data.rules.test.js`

**Interfaces:**
- Consumes: `db`, `storage`, `auth` from `js/firebase-config.js` (Phase 1/6)
- Produces: `postActivity(jobId, { text, file })` (returns `Promise<string>`, the new entry's ID — `file` is optional; uploads to Storage first if present, then writes the Firestore doc), `listActivity(jobId, callback)` (returns an unsubscribe function; callback receives an array of `{ id, ...data }` ordered by `createdAt` descending) — Task 3's `js/main.js` calls both.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/rules/activity-data.rules.test.js
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

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
    const setupDb = ctx.firestore();
    await setupDb.collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
    await setupDb.collection("jobs").doc("job-1").set({ status: "JOB_SCHEDULED", customerName: "A" });
  });
  db = testEnv.authenticatedContext("staff-uid").firestore();
});

after(async () => {
  await testEnv.cleanup();
});

test("creating an activity entry stores text, authorUid, authorEmail", async () => {
  const ref = await db.collection("jobs").doc("job-1").collection("activity").add({
    text: "Delivered lumber", photoUrl: null, authorUid: "staff-uid", authorEmail: "staff@test.local",
  });
  const snap = await ref.get();
  const data = snap.data();
  assert.equal(data.text, "Delivered lumber");
  assert.equal(data.authorUid, "staff-uid");
  assert.equal(data.authorEmail, "staff@test.local");
});
```

- [ ] **Step 2: Run the test to verify it passes as a raw Firestore call**

Run: `npm run test:rules`
Expected: PASS (this locks in the expected data shape via a raw SDK call before `js/activity.js` wraps it, same reasoning as the equivalent Phase 1/6 tests).

- [ ] **Step 3: Write `js/activity.js`**

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

export async function postActivity(jobId, { text, file }) {
  let photoUrl = null;
  if (file) {
    const path = `jobs/${jobId}/activity/${Date.now()}_${file.name}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    photoUrl = await getDownloadURL(fileRef);
  }

  const docRef = await addDoc(collection(db, "jobs", jobId, "activity"), {
    text: text || null,
    photoUrl,
    authorUid: auth.currentUser.uid,
    authorEmail: auth.currentUser.email,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export function listActivity(jobId, callback) {
  const q = query(
    collection(db, "jobs", jobId, "activity"),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      console.error("listActivity snapshot error:", error);
      callback([]);
    }
  );
}
```

- [ ] **Step 4: Run the tests again to confirm nothing regressed**

Run: `npm run test:rules`
Expected: PASS — the new test from Step 1 plus every test from Task 1 and all prior phases still green.

- [ ] **Step 5: Commit**

```bash
git add js/activity.js tests/rules/activity-data.rules.test.js
git commit -m "feat: add job-site activity feed data layer"
```

---

### Task 3: Job Activity UI on the Job Detail page

**Files:**
- Modify: `index.html`
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `postActivity`, `listActivity` (Task 2)

- [ ] **Step 1: Add markup to `index.html`**

The current `#job-detail-section` (as of the Phase 6 photo-capture-button change) ends with:
```html
      <p id="receipts-staff-only-notice" hidden>Materials receipts are only visible to staff.</p>
    </div>
  </div>
```
Add a new `#activity-section` right after the `#receipts-staff-only-notice` line, still inside `#job-detail-section`:

```html
      <p id="receipts-staff-only-notice" hidden>Materials receipts are only visible to staff.</p>

      <div id="activity-section">
        <h3>Job Activity</h3>
        <div id="activity-list"></div>
        <form id="add-activity-form">
          <textarea id="activity-text" placeholder="Add a note (optional)..." rows="2"></textarea>
          <button type="button" id="activity-photo-btn" class="photo-capture-btn">📷 Add Photo</button>
          <input type="file" id="activity-file" accept="image/*" hidden />
          <p id="activity-file-status">No photo selected yet</p>
          <button type="submit" class="btn-primary">Post Update</button>
        </form>
      </div>
    </div>
  </div>
```

Unlike `#receipts-section`, this section is NOT gated by role — it renders unconditionally for anyone who can open the job detail view.

- [ ] **Step 2: Add CSS**

In the `<style>` block, add `textarea` to the existing shared form-control selector (find the rule starting `input[type="email"], input[type="password"], ...` and add `, textarea` to its selector list, and to the `#app-view input[type="email"], ...` background-override rule below it the same way). Then add new rules for activity entries, placed after the existing `.receipt-row` rules:

```css
textarea {
  font-family: inherit;
  resize: vertical;
  width: 100%;
}

.activity-entry {
  display: flex;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--plank-line);
}
.activity-entry:last-of-type { border-bottom: none; }
.activity-entry img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: var(--r-btn);
  border: 1px solid var(--plank-line);
  flex-shrink: 0;
}
.activity-entry .activity-body { flex: 1; font-size: 0.92rem; }
.activity-entry .activity-meta {
  font-size: 0.78rem;
  color: var(--slate);
  margin-top: 2px;
}

#add-activity-form { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.75rem; }
```

- [ ] **Step 3: Wire `js/main.js`**

Add this import at the top, alongside the existing ones:
```javascript
import { postActivity, listActivity } from "./activity.js";
```

Add element references near the existing receipt ones:
```javascript
const activityList = document.getElementById("activity-list");
const addActivityForm = document.getElementById("add-activity-form");
const activityTextInput = document.getElementById("activity-text");
const activityPhotoBtn = document.getElementById("activity-photo-btn");
const activityFileInput = document.getElementById("activity-file");
const activityFileStatus = document.getElementById("activity-file-status");
```

Add a state variable near `unsubscribeReceipts`:
```javascript
let unsubscribeActivity = null;
```

Wire the photo button and file-selection status, the same pattern as the receipt photo button:
```javascript
activityPhotoBtn.addEventListener("click", () => activityFileInput.click());

activityFileInput.addEventListener("change", () => {
  const file = activityFileInput.files[0];
  if (file) {
    activityFileStatus.textContent = "Selected: " + file.name;
    activityFileStatus.classList.add("has-file");
  } else {
    activityFileStatus.textContent = "No photo selected yet";
    activityFileStatus.classList.remove("has-file");
  }
});
```

Add the submit handler (place it near the `addReceiptForm` handler):
```javascript
addActivityForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  appError.textContent = "";
  const text = activityTextInput.value.trim();
  const file = activityFileInput.files[0];
  if (!text && !file) {
    appError.textContent = "Add a note or a photo before posting.";
    return;
  }
  try {
    await postActivity(currentJobId, { text: text || null, file: file || null });
    addActivityForm.reset();
    activityFileStatus.textContent = "No photo selected yet";
    activityFileStatus.classList.remove("has-file");
  } catch (err) {
    appError.textContent = "Could not post update: " + err.message;
  }
});
```

Add a `renderActivity` function (place it near `renderReceipts`):
```javascript
function renderActivity(entries) {
  activityList.innerHTML = "";
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "activity-entry";

    if (entry.photoUrl) {
      const img = document.createElement("img");
      img.src = entry.photoUrl;
      img.alt = "Job photo";
      row.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "activity-body";
    if (entry.text) {
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent = entry.text;
      body.appendChild(p);
    }
    const meta = document.createElement("p");
    meta.className = "activity-meta";
    meta.textContent = entry.authorEmail ?? "Unknown";
    body.appendChild(meta);
    row.appendChild(body);

    activityList.appendChild(row);
  }
}
```

Finally, update `openJobDetail` and `closeJobDetail` to subscribe/unsubscribe the activity feed alongside the existing receipts subscription. The current `openJobDetail` (as of Phase 6) is:
```javascript
function openJobDetail(job) {
  currentJobId = job.id;
  pipelineSection.hidden = true;
  jobDetailSection.hidden = false;
  jobDetailTitle.textContent = job.customerName ?? "(no name)";
  jobDetailStatus.textContent = job.status;
  jobDetailStatus.className = "stage-badge " + stageBadgeClass(job.status);
  receiptsList.innerHTML = "";
  receiptsTotal.textContent = "";

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
```
Add activity subscription unconditionally (not inside the staff-only branch), e.g. right after the `if/else` block closes:
```javascript
  if (unsubscribeActivity) unsubscribeActivity();
  activityList.innerHTML = "";
  unsubscribeActivity = listActivity(currentJobId, renderActivity);
}
```

The current `closeJobDetail` (as of Phase 6) is:
```javascript
function closeJobDetail() {
  if (unsubscribeReceipts) {
    unsubscribeReceipts();
    unsubscribeReceipts = null;
  }
  currentJobId = null;
  jobDetailSection.hidden = true;
  pipelineSection.hidden = false;
}
```
Add activity cleanup alongside the receipts cleanup:
```javascript
function closeJobDetail() {
  if (unsubscribeReceipts) {
    unsubscribeReceipts();
    unsubscribeReceipts = null;
  }
  if (unsubscribeActivity) {
    unsubscribeActivity();
    unsubscribeActivity = null;
  }
  currentJobId = null;
  jobDetailSection.hidden = true;
  pipelineSection.hidden = false;
}
```

Read the actual current `js/main.js` before editing — confirm these two functions match what's quoted here, and adapt precisely to whatever has actually changed since, the same way Task 4 of the Phase 6 plan required.

- [ ] **Step 4: Manual verification (non-browser)**

No automated test for this UI file (matching every prior UI task in this project). Proofread: every `document.getElementById(...)` call has a matching id in the edited `index.html`; `postActivity`/`listActivity` are called with the exact signatures `js/activity.js` exports. If a browser is available in this environment, do a quick `curl` check that the served `index.html` contains the new element ids — otherwise note in the report that full interactive verification is deferred to the controller.

- [ ] **Step 5: Commit**

```bash
git add index.html js/main.js
git commit -m "feat: add job-site activity feed UI to the Job Detail page"
```

---

### Task 4: End-to-end verification and vault update

No new files — a final manual pass plus documentation. This task is expected to be performed by the controller directly (interactive browser verification), not dispatched to an implementer subagent, matching the pattern established in Phases 1 and 6.

- [ ] **Step 1: Full activity-feed walk, staff view**

With emulators + served app running, signed in as staff: open a job, post a text-only update, post a photo-only update, post a combined text+photo update. Confirm all three render correctly in the feed (newest first), and that the "Add Photo" button behaves exactly like the receipts one (independent trigger, status line updates on selection, resets after successful post).

- [ ] **Step 2: Crew-assignment-dependent check**

Since no UI exists yet to set a job's `assignedCrew` (Phase 4 is not built), verify the crew side of this feature via direct Firestore REST calls (matching how Phase 1 verified the crew-list-query fix): seed a job with `assignedCrew` containing a crew test user's uid directly via REST, sign in as that crew user, and confirm they can see and post to that job's activity feed once they can reach its Job Detail page (crew's own job list is still empty per the known Phase-4 dependency — this check can use the same direct-Firestore-REST-plus-manual-navigation approach used in Phase 1's verification, or the automated rules tests from Task 1 may already be sufcient evidence — use judgment on how much live-browser crew verification is worth doing given the Phase 4 gap, and say so explicitly in the session log either way).

- [ ] **Step 3: Full regression check**

Run: `npm run test:unit && npm run test:rules`
Expected: all tests from every phase pass together.

- [ ] **Step 4: Update the vault**

Update `DZ obsidian/projects/decked-out-wnc/architecture.md`'s status line to reflect Phase 5 as built, and log the session in `DZ obsidian/projects/decked-out-wnc/sessions/<date>.md`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: Phase 5 job-site activity feed complete"
```
