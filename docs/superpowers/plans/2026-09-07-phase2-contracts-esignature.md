# Phase 2: Contracts, E-Signature, and PDF Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff send a customer a real contract from a WON job, let the customer read and sign it with no login required, and produce a real signed PDF for both parties.

**Architecture:** Every customer-facing read/write goes through Cloud Functions using the Admin SDK (never direct Firestore/Storage client access) — the customer's unguessable link token is their only access. Staff-facing actions (send, resend) are Firebase callable functions guarded by a staff-role check mirroring `isStaff()`. Contract data lives in a new staff-only `jobs/{jobId}/contract/details` doc; a `documentLinks/{token}` collection maps tokens to jobs and is never read by any client SDK at all.

**Tech Stack:** Firebase Cloud Functions v2 (Node 20, ES modules), `firebase-admin`, `resend` (email), `pdfmake` (PDF generation), `cors`, `signature_pad` (browser, via CDN). Reuses the existing Firestore/Auth/Storage emulators for all automated tests — no new emulator dependency for the test suite itself.

**Spec:** `docs/superpowers/specs/2026-09-07-phase2-contracts-esignature-design.md`

## Global Constraints

- The customer never gets a Firebase Auth session. All customer-facing functions are plain public HTTPS endpoints (`onRequest`), not `onCall`.
- Never persist a permanent Storage download URL. `signatureImagePath`/`pdfPath` store Storage **paths**; a fresh short-lived signed URL is minted on demand via `bucket.file(path).getSignedUrl(...)`.
- `jobs/{jobId}/contract/details` and `documentLinks/{token}` are staff-only/no-client-access respectively — matches `receipts`' existing lockdown pattern.
- The two contract-driven stage transitions (`WON`→`CONTRACT_SENT`, `CONTRACT_SENT`→`CONTRACT_SIGNED`) must not be manually selectable in the pipeline's "Advance to…" dropdown — they only happen via the real send/sign actions.
- Functions code uses ES modules (`"type": "module"` in `functions/package.json`), matching the rest of this codebase — not the CommonJS Firebase default scaffold.
- All business logic is written as a plain exported async function (e.g. `sendContractLogic`) with a thin `onCall`/`onRequest` wrapper around it, so tests call the logic directly against the emulators without needing the Functions emulator running.
- Any function that sends email accepts an injectable `sendEmailFn` (defaulting to the real `sendEmail`), so automated tests never make a real network call to Resend — matches the spec's "automated tests mock the Resend call" requirement.
- Node version for Cloud Functions: **20** (`"engines": { "node": "20" }` in `functions/package.json`).

---

### Task 1: Firestore + Storage security rules for contracts

**Files:**
- Modify: `firestore.rules`
- Modify: `storage.rules`
- Create: `tests/rules/contract.rules.test.js`

**Interfaces:**
- Produces: the `jobs/{jobId}/contract/{docId}` and `documentLinks/{token}` Firestore rule paths, and the `jobs/{jobId}/contract/{fileName}` Storage rule path, that every later task's writes/reads rely on being correctly locked down.

- [ ] **Step 1: Add the Firestore rules**

In `firestore.rules`, add these two `match` blocks inside `match /databases/{database}/documents { ... }`, alongside the existing `match /jobs/{jobId}/receipts/{receiptId}` block:

```
    match /jobs/{jobId}/contract/{docId} {
      allow read, write: if isStaff();
    }

    match /documentLinks/{token} {
      allow read, write: if false;
    }
```

- [ ] **Step 2: Add the Storage rule**

In `storage.rules`, add this block alongside the existing `match /jobs/{jobId}/receipts/{fileName}` block:

```
    match /jobs/{jobId}/contract/{fileName} {
      allow read: if isStaff();
      allow write: if false;
    }
```

- [ ] **Step 3: Write the rules tests**

Create `tests/rules/contract.rules.test.js`:

```js
// tests/rules/contract.rules.test.js
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
    await db.collection("jobs").doc("job-1").set({ status: "CONTRACT_SENT", customerName: "A" });
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

test("staff can read a job's contract details", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-1").collection("contract").doc("details").set({
      status: "SENT", contractText: "x", token: "tok-1",
    });
  });
  const db = staffCtx().firestore();
  await assertSucceeds(db.collection("jobs").doc("job-1").collection("contract").doc("details").get());
});

test("staff can write a job's contract details", async () => {
  const db = staffCtx().firestore();
  await assertSucceeds(
    db.collection("jobs").doc("job-1").collection("contract").doc("details").set({
      status: "SENT", contractText: "x", token: "tok-1",
    })
  );
});

test("crew cannot read a job's contract details", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("jobs").doc("job-1").collection("contract").doc("details").set({
      status: "SENT", contractText: "x", token: "tok-1",
    });
  });
  const db = crewCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-1").collection("contract").doc("details").get());
});

test("crew cannot write a job's contract details", async () => {
  const db = crewCtx().firestore();
  await assertFails(
    db.collection("jobs").doc("job-1").collection("contract").doc("details").set({ status: "SENT" })
  );
});

test("unauthenticated user cannot read or write contract details", async () => {
  const db = anonCtx().firestore();
  await assertFails(db.collection("jobs").doc("job-1").collection("contract").doc("details").get());
  await assertFails(
    db.collection("jobs").doc("job-1").collection("contract").doc("details").set({ status: "SENT" })
  );
});

test("no client role — including staff — can read documentLinks", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection("documentLinks").doc("tok-1").set({ jobId: "job-1", kind: "contract" });
  });
  await assertFails(staffCtx().firestore().collection("documentLinks").doc("tok-1").get());
  await assertFails(crewCtx().firestore().collection("documentLinks").doc("tok-1").get());
  await assertFails(anonCtx().firestore().collection("documentLinks").doc("tok-1").get());
});

test("no client role can write documentLinks", async () => {
  await assertFails(staffCtx().firestore().collection("documentLinks").doc("tok-2").set({ jobId: "job-1" }));
});

test("staff can read a signed contract PDF from Storage", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref("jobs/job-1/contract/signed.pdf").put(new Uint8Array([1, 2, 3]));
  });
  const storage = staffCtx().storage();
  await assertSucceeds(storage.ref("jobs/job-1/contract/signed.pdf").getDownloadURL());
});

test("staff cannot upload directly to a contract Storage path", async () => {
  const storage = staffCtx().storage();
  await assertFails(
    storage.ref("jobs/job-1/contract/signed.pdf").put(new Uint8Array([1, 2, 3]), { contentType: "application/pdf" })
  );
});

test("crew cannot read a contract PDF from Storage", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref("jobs/job-1/contract/signed.pdf").put(new Uint8Array([1, 2, 3]));
  });
  const storage = crewCtx().storage();
  await assertFails(storage.ref("jobs/job-1/contract/signed.pdf").getDownloadURL());
});

test("unauthenticated user cannot read a contract PDF from Storage", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.storage().ref("jobs/job-1/contract/signed.pdf").put(new Uint8Array([1, 2, 3]));
  });
  const storage = anonCtx().storage();
  await assertFails(storage.ref("jobs/job-1/contract/signed.pdf").getDownloadURL());
});
```

- [ ] **Step 4: Run the rules tests**

Run: `npm run test:rules`
Expected: all tests pass, including the new `contract.rules.test.js` file (it's already picked up by the existing glob `tests/rules/**/*.test.js`).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules storage.rules tests/rules/contract.rules.test.js
git commit -m "feat: add Firestore/Storage rules for contract data (staff-only, documentLinks client-unreachable)"
```

---

### Task 2: Cloud Functions project scaffolding

**Files:**
- Create: `functions/package.json`
- Create: `functions/lib/admin.js`
- Create: `functions/test/admin.test.js`
- Modify: `firebase.json`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `db` and `bucket` (exported from `functions/lib/admin.js`) — every later Cloud Function imports these instead of initializing the Admin SDK itself.

- [ ] **Step 1: Create the functions package**

Create `functions/package.json`:

```json
{
  "name": "decked-out-wnc-functions",
  "private": true,
  "type": "module",
  "engines": { "node": "20" },
  "main": "index.js",
  "dependencies": {
    "firebase-admin": "^12.6.0",
    "firebase-functions": "^5.1.0",
    "resend": "^4.0.0",
    "pdfmake": "^0.2.12",
    "cors": "^2.8.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd functions && npm install && cd ..`
Expected: `functions/node_modules/` created, `functions/package-lock.json` created.

- [ ] **Step 3: Write the Admin SDK init module**

Create `functions/lib/admin.js`:

```js
import admin from "firebase-admin";

const projectId = process.env.GCLOUD_PROJECT || "deckedoutwnc";

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId,
    storageBucket: `${projectId}.firebasestorage.app`,
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
```

- [ ] **Step 4: Write a test proving the emulator wiring works**

Create `functions/test/admin.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, bucket } from "../lib/admin.js";

test("Admin SDK can write and read a document against the Firestore emulator", async () => {
  await db.collection("_scaffold_check").doc("ping").set({ ok: true });
  const snap = await db.collection("_scaffold_check").doc("ping").get();
  assert.equal(snap.data().ok, true);
});

test("Admin SDK can write and read a file against the Storage emulator", async () => {
  const file = bucket.file("_scaffold_check/ping.txt");
  await file.save(Buffer.from("ok"), { contentType: "text/plain" });
  const [contents] = await file.download();
  assert.equal(contents.toString(), "ok");
});
```

- [ ] **Step 5: Add the Functions emulator and functions source to `firebase.json`**

Modify `firebase.json` — add a top-level `"functions"` key and a `"functions"` entry under `"emulators"`:

```json
{
  "functions": {
    "source": "functions"
  },
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
    "functions": { "port": 5001 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

- [ ] **Step 6: Add npm scripts for functions**

Modify `package.json`'s `"scripts"` block — add `test:functions` and update `emulators` to include `functions`:

```json
  "scripts": {
    "test:unit": "node --test \"tests/unit/**/*.test.js\"",
    "test:rules": "firebase emulators:exec --project deckedoutwnc-test --only firestore,storage \"node --test --test-concurrency=1 tests/rules/**/*.test.js\"",
    "test:functions": "firebase emulators:exec --project deckedoutwnc-test --only firestore,auth,storage \"node --env-file=functions/.secret.local --test --test-concurrency=1 functions/test/**/*.test.js\"",
    "emulators": "firebase emulators:start --only firestore,auth,storage,functions"
  }
```

- [ ] **Step 7: Create the local secret file and gitignore it**

Create `functions/.secret.local` with the real Resend API key (copy the value from `local-secrets.txt` at the repo root — do not type a new one):

```
RESEND_API_KEY=<value from local-secrets.txt>
```

Add to `.gitignore` (root file):

```
functions/.secret.local
```

- [ ] **Step 8: Run the scaffolding test**

Run: `npm run test:functions`
Expected: both tests in `functions/test/admin.test.js` pass. (This step doesn't touch Resend at all, so the `--env-file` flag loading an empty-ish file is harmless here — it matters starting Task 4.)

- [ ] **Step 9: Commit**

```bash
git add functions/package.json functions/lib/admin.js functions/test/admin.test.js firebase.json package.json .gitignore
git commit -m "feat: scaffold Cloud Functions project (Admin SDK, emulator config, test wiring)"
```

Note: `functions/package-lock.json` and `functions/node_modules/` are untracked — `node_modules/` is already covered by the root `.gitignore`'s existing `node_modules/` pattern (it matches at any depth). Commit `functions/package-lock.json` too if `git status` shows it as untracked and not ignored.

---

### Task 3: Contract template-filling function

**Files:**
- Create: `functions/lib/contractTemplate.js`
- Create: `functions/test/contractTemplate.test.js`

**Interfaces:**
- Produces: `fillContractTemplate({ customerName, address, scopeOfWork, bidAmount, depositPercent, sentDate })` → `string`. Used by Task 4's `sendContract`.

- [ ] **Step 1: Write the failing test**

Create `functions/test/contractTemplate.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillContractTemplate } from "../lib/contractTemplate.js";

test("fills in customer name, address, scope, price, and deposit", () => {
  const text = fillContractTemplate({
    customerName: "Jane Doe",
    address: "123 Main St, Asheville, NC",
    scopeOfWork: "Build a 12x14 pressure-treated deck with railing.",
    bidAmount: 12000,
    depositPercent: 30,
    sentDate: "09/07/2026",
  });

  assert.ok(text.includes("Jane Doe"));
  assert.ok(text.includes("123 Main St, Asheville, NC"));
  assert.ok(text.includes("Build a 12x14 pressure-treated deck with railing."));
  assert.ok(text.includes("$12,000.00"));
  assert.ok(text.includes("30%"));
  assert.ok(text.includes("$3,600.00")); // 30% of $12,000
  assert.ok(text.includes("09/07/2026"));
  assert.ok(!text.includes("{{"));
});

test("does not leave any unfilled placeholders", () => {
  const text = fillContractTemplate({
    customerName: "A",
    address: "B",
    scopeOfWork: "C",
    bidAmount: 100,
    depositPercent: 10,
    sentDate: "01/01/2026",
  });
  assert.ok(!text.includes("{{") && !text.includes("}}"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test functions/test/contractTemplate.test.js`
Expected: FAIL with "Cannot find module '../lib/contractTemplate.js'"

- [ ] **Step 3: Write the implementation**

Create `functions/lib/contractTemplate.js`:

```js
const TEMPLATE = `RESIDENTIAL DECK CONSTRUCTION AGREEMENT

This Agreement is made between Decked Out WNC Inc. ("Contractor") and
{{customerName}} ("Owner"), for the property located at {{address}}.

1. SCOPE OF WORK
{{scopeOfWork}}

2. CONTRACT PRICE
The total price for the work described above is {{bidAmount}}.

3. PAYMENT SCHEDULE
A deposit of {{depositPercent}}% ({{depositAmount}}) is due
upon signing this Agreement, before materials are ordered. The remaining balance
is due upon substantial completion of the work.

4. CHANGE ORDERS
Any change to the scope of work described above must be agreed to in writing by
both parties and may adjust the contract price and/or timeline accordingly.

5. TIMELINE
Contractor will provide an estimated start date and completion timeframe once
scheduling is confirmed. Actual timeline may be affected by weather, permitting,
and material availability.

6. PERMITS
Contractor is responsible for obtaining any building permits required for this
project.

7. WARRANTY
Contractor warrants its workmanship for a period of one (1) year from the date
of substantial completion. Manufacturer warranties on materials, where
applicable, are passed through to Owner.

8. INSURANCE
Contractor carries general liability insurance and will provide proof of
coverage upon request.

9. TERMINATION
Either party may terminate this Agreement for material breach upon written
notice. Owner remains responsible for payment for work completed and materials
already ordered as of the date of termination.

10. GOVERNING LAW
This Agreement is governed by the laws of the State of North Carolina.

11. ENTIRE AGREEMENT
This document constitutes the entire agreement between the parties and
supersedes all prior discussions regarding this project.

Accepted and agreed:

Owner: ____________________________  Date: ______________
       {{customerName}}

Contractor: Decked Out WNC Inc.       Date: {{sentDate}}`;

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function fillContractTemplate({ customerName, address, scopeOfWork, bidAmount, depositPercent, sentDate }) {
  const depositAmount = bidAmount * (depositPercent / 100);
  return TEMPLATE
    .replaceAll("{{customerName}}", customerName)
    .replaceAll("{{address}}", address)
    .replaceAll("{{scopeOfWork}}", scopeOfWork)
    .replaceAll("{{bidAmount}}", formatCurrency(bidAmount))
    .replaceAll("{{depositPercent}}", String(depositPercent))
    .replaceAll("{{depositAmount}}", formatCurrency(depositAmount))
    .replaceAll("{{sentDate}}", sentDate);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test functions/test/contractTemplate.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add functions/lib/contractTemplate.js functions/test/contractTemplate.test.js
git commit -m "feat: add contract template-filling function"
```

---

### Task 4: Email helper and `sendContract`

**Files:**
- Create: `functions/lib/email.js`
- Create: `functions/sendContract.js`
- Create: `functions/test/sendContract.test.js`
- Modify: `functions/index.js` (create if it doesn't exist yet)

**Interfaces:**
- Consumes: `fillContractTemplate` (Task 3), `db` (Task 2).
- Produces: `sendEmail({ to, subject, html, attachments })` (Task 6 and Task 7 both reuse this). `sendContractLogic(data, uid, deps)` and the exported `sendContract` callable.

- [ ] **Step 1: Write the email helper**

Create `functions/lib/email.js`:

```js
import { Resend } from "resend";

export async function sendEmail({ to, subject, html, attachments }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: "Decked Out WNC <contracts@deckedoutwnc.com>",
    to,
    subject,
    html,
    attachments,
  });
  if (error) {
    throw new Error(`Resend email failed: ${error.message}`);
  }
}
```

- [ ] **Step 2: Write the failing test for `sendContractLogic`**

Create `functions/test/sendContract.test.js`:

```js
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/admin.js";
import { sendContractLogic } from "../sendContract.js";

beforeEach(async () => {
  await db.recursiveDelete(db.collection("jobs"));
  await db.recursiveDelete(db.collection("documentLinks"));
  await db.recursiveDelete(db.collection("users"));
  await db.collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
  await db.collection("users").doc("crew-uid").set({ role: "crew", name: "Crew Person" });
  await db.collection("jobs").doc("job-1").set({
    status: "WON",
    customerName: "Jane Doe",
    address: "1 Main St",
    email: "jane@example.com",
  });
});

test("creates a contract doc, a documentLinks entry, and advances the job to CONTRACT_SENT", async () => {
  let sentEmail = null;
  await sendContractLogic(
    { jobId: "job-1", bidAmount: 10000, scopeOfWork: "Build a 12x14 deck.", depositPercent: 30 },
    "staff-uid",
    { sendEmailFn: async (opts) => { sentEmail = opts; } }
  );

  const jobSnap = await db.collection("jobs").doc("job-1").get();
  assert.equal(jobSnap.data().status, "CONTRACT_SENT");

  const contractSnap = await db.collection("jobs").doc("job-1").collection("contract").doc("details").get();
  assert.equal(contractSnap.data().status, "SENT");
  assert.equal(contractSnap.data().bidAmount, 10000);
  assert.ok(contractSnap.data().contractText.includes("Jane Doe"));
  assert.ok(contractSnap.data().token);

  const linkSnap = await db.collection("documentLinks").doc(contractSnap.data().token).get();
  assert.equal(linkSnap.data().jobId, "job-1");
  assert.equal(linkSnap.data().kind, "contract");

  assert.equal(sentEmail.to, "jane@example.com");
  assert.ok(sentEmail.html.includes(contractSnap.data().token));
});

test("rejects a non-staff caller", async () => {
  await assert.rejects(
    sendContractLogic(
      { jobId: "job-1", bidAmount: 10000, scopeOfWork: "x", depositPercent: 30 },
      "crew-uid",
      { sendEmailFn: async () => {} }
    )
  );
});

test("rejects a caller with no uid at all", async () => {
  await assert.rejects(
    sendContractLogic(
      { jobId: "job-1", bidAmount: 10000, scopeOfWork: "x", depositPercent: 30 },
      undefined,
      { sendEmailFn: async () => {} }
    )
  );
});

test("rejects a job that isn't WON", async () => {
  await db.collection("jobs").doc("job-1").update({ status: "LEAD_IN" });
  await assert.rejects(
    sendContractLogic(
      { jobId: "job-1", bidAmount: 10000, scopeOfWork: "x", depositPercent: 30 },
      "staff-uid",
      { sendEmailFn: async () => {} }
    )
  );
});

test("rejects a missing scopeOfWork", async () => {
  await assert.rejects(
    sendContractLogic(
      { jobId: "job-1", bidAmount: 10000, depositPercent: 30 },
      "staff-uid",
      { sendEmailFn: async () => {} }
    )
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:functions`
Expected: FAIL with "Cannot find module '../sendContract.js'"

- [ ] **Step 4: Write the implementation**

Create `functions/sendContract.js`:

```js
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { randomBytes } from "node:crypto";
import { db } from "./lib/admin.js";
import { requireStaff } from "./lib/auth.js";
import { fillContractTemplate } from "./lib/contractTemplate.js";
import { sendEmail } from "./lib/email.js";

const resendApiKey = defineSecret("RESEND_API_KEY");
const APP_ORIGIN = process.env.APP_ORIGIN || "http://127.0.0.1:8090";

export async function sendContractLogic(data, uid, deps = {}) {
  const { sendEmailFn = sendEmail } = deps;
  await requireStaff(uid);

  const { jobId, bidAmount, scopeOfWork, depositPercent } = data;
  if (!jobId || !bidAmount || !scopeOfWork || !depositPercent) {
    throw new HttpsError("invalid-argument", "jobId, bidAmount, scopeOfWork, and depositPercent are required.");
  }

  const jobRef = db.collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new HttpsError("not-found", "Job not found.");
  }
  const job = jobSnap.data();
  if (job.status !== "WON") {
    throw new HttpsError("failed-precondition", "Contract can only be sent for a job in the WON stage.");
  }

  const sentDate = new Date().toLocaleDateString("en-US");
  const contractText = fillContractTemplate({
    customerName: job.customerName,
    address: job.address,
    scopeOfWork,
    bidAmount: Number(bidAmount),
    depositPercent: Number(depositPercent),
    sentDate,
  });

  const token = randomBytes(32).toString("hex");

  await db.collection("documentLinks").doc(token).set({
    jobId,
    kind: "contract",
    createdAt: new Date(),
  });

  await jobRef.collection("contract").doc("details").set({
    status: "SENT",
    bidAmount: Number(bidAmount),
    scopeOfWork,
    depositPercent: Number(depositPercent),
    contractText,
    token,
    sentAt: new Date(),
    signedAt: null,
    signerName: null,
    signatureImagePath: null,
    pdfPath: null,
    signerIp: null,
    signerUserAgent: null,
  });

  await jobRef.update({ status: "CONTRACT_SENT" });

  const signingUrl = `${APP_ORIGIN}/sign.html?token=${token}`;
  await sendEmailFn({
    to: job.email,
    subject: "Your contract from Decked Out WNC",
    html: `<p>Hi ${job.customerName},</p><p>Please review and sign your contract:</p><p><a href="${signingUrl}">${signingUrl}</a></p>`,
  });

  return { ok: true };
}

export const sendContract = onCall({ secrets: [resendApiKey] }, (request) =>
  sendContractLogic(request.data, request.auth?.uid)
);
```

Create `functions/lib/auth.js`:

```js
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin.js";

export async function requireStaff(uid) {
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const snap = await db.collection("users").doc(uid).get();
  if (snap.data()?.role !== "staff") {
    throw new HttpsError("permission-denied", "Staff access required.");
  }
}
```

Create `functions/index.js`:

```js
export { sendContract } from "./sendContract.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:functions`
Expected: PASS (all 5 tests in `sendContract.test.js`, plus the earlier `admin.test.js` and `contractTemplate.test.js` — note `contractTemplate.test.js` doesn't need the emulators and can also run via plain `node --test functions/test/contractTemplate.test.js`, but running it through `npm run test:functions` is fine too).

- [ ] **Step 6: Commit**

```bash
git add functions/lib/email.js functions/lib/auth.js functions/sendContract.js functions/test/sendContract.test.js functions/index.js
git commit -m "feat: add sendContract Cloud Function"
```

---

### Task 5: `getContractByToken`

**Files:**
- Create: `functions/getContractByToken.js`
- Create: `functions/test/getContractByToken.test.js`
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `db`, `bucket` (Task 2).
- Produces: `getContractByTokenLogic(token, deps)` and the exported `getContractByToken` public HTTPS function. Used by Task 9's `sign.html`.

- [ ] **Step 1: Write the failing test**

Create `functions/test/getContractByToken.test.js`:

```js
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/admin.js";
import { getContractByTokenLogic } from "../getContractByToken.js";

beforeEach(async () => {
  await db.recursiveDelete(db.collection("jobs"));
  await db.recursiveDelete(db.collection("documentLinks"));
  await db.collection("jobs").doc("job-1").set({
    status: "CONTRACT_SENT", customerName: "Jane Doe", email: "jane@example.com",
  });
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").set({
    status: "SENT", contractText: "Test contract text.", token: "tok-1",
  });
  await db.collection("documentLinks").doc("tok-1").set({ jobId: "job-1", kind: "contract", createdAt: new Date() });
});

test("returns the contract text for an unsigned contract", async () => {
  const result = await getContractByTokenLogic("tok-1");
  assert.equal(result.status, "SENT");
  assert.equal(result.contractText, "Test contract text.");
  assert.equal(result.customerName, "Jane Doe");
});

test("returns signed state with a minted PDF URL once signed", async () => {
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").update({
    status: "SIGNED", signedAt: new Date("2026-09-07T12:00:00Z"), pdfPath: "jobs/job-1/contract/signed.pdf",
  });
  const result = await getContractByTokenLogic("tok-1", {
    mintUrlFn: async (path) => `https://example.com/mock-signed-url?path=${path}`,
  });
  assert.equal(result.status, "SIGNED");
  assert.ok(result.pdfUrl.includes("signed.pdf"));
  assert.equal(result.signedAt, "2026-09-07T12:00:00.000Z");
});

test("rejects an unknown token", async () => {
  await assert.rejects(getContractByTokenLogic("does-not-exist"), /Invalid or unknown link/);
});

test("rejects a missing token", async () => {
  await assert.rejects(getContractByTokenLogic(undefined), /Missing token/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:functions`
Expected: FAIL with "Cannot find module '../getContractByToken.js'"

- [ ] **Step 3: Write the implementation**

Create `functions/getContractByToken.js`:

```js
import { onRequest } from "firebase-functions/v2/https";
import cors from "cors";
import { db, bucket } from "./lib/admin.js";

const corsHandler = cors({ origin: true });

async function defaultMintUrl(path) {
  const [url] = await bucket.file(path).getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });
  return url;
}

export async function getContractByTokenLogic(token, deps = {}) {
  const { mintUrlFn = defaultMintUrl } = deps;
  if (!token) {
    throw new Error("Missing token.");
  }
  const linkSnap = await db.collection("documentLinks").doc(token).get();
  if (!linkSnap.exists) {
    throw new Error("Invalid or unknown link.");
  }
  const { jobId } = linkSnap.data();

  const jobSnap = await db.collection("jobs").doc(jobId).get();
  const contractSnap = await db.collection("jobs").doc(jobId).collection("contract").doc("details").get();
  const job = jobSnap.data();
  const contract = contractSnap.data();

  if (contract.status === "SIGNED") {
    const pdfUrl = await mintUrlFn(contract.pdfPath);
    return {
      status: "SIGNED",
      customerName: job.customerName,
      signedAt: contract.signedAt.toDate().toISOString(),
      pdfUrl,
    };
  }

  return {
    status: "SENT",
    customerName: job.customerName,
    contractText: contract.contractText,
  };
}

export const getContractByToken = onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const token = req.method === "GET" ? req.query.token : req.body.token;
      const result = await getContractByTokenLogic(token);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
});
```

Modify `functions/index.js`:

```js
export { sendContract } from "./sendContract.js";
export { getContractByToken } from "./getContractByToken.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:functions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add functions/getContractByToken.js functions/test/getContractByToken.test.js functions/index.js
git commit -m "feat: add getContractByToken Cloud Function"
```

---

### Task 6: PDF generation and `submitSignature`

**Files:**
- Create: `functions/lib/pdf.js`
- Create: `functions/test/pdf.test.js`
- Create: `functions/submitSignature.js`
- Create: `functions/test/submitSignature.test.js`
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `db`, `bucket` (Task 2), `sendEmail` (Task 4).
- Produces: `generateContractPdf({ contractText, signatureImageBuffer, signerName, signedAt })` → `Promise<Buffer>`. `submitSignatureLogic(data, headers, deps)` and the exported `submitSignature` public HTTPS function. Used by Task 9's `sign.html`.

- [ ] **Step 1: Write the failing test for PDF generation**

Create `functions/test/pdf.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateContractPdf } from "../lib/pdf.js";

// A well-known minimal valid 1x1 transparent PNG, used purely as fake signature-image bytes.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("generateContractPdf produces a valid PDF buffer", async () => {
  const buffer = await generateContractPdf({
    contractText: "Test contract text.",
    signatureImageBuffer: TINY_PNG,
    signerName: "Jane Doe",
    signedAt: "09/07/2026",
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test functions/test/pdf.test.js`
Expected: FAIL with "Cannot find module '../lib/pdf.js'"

- [ ] **Step 3: Write the PDF generation implementation**

Create `functions/lib/pdf.js`:

```js
import PdfPrinter from "pdfmake";

const fonts = {
  Roboto: {
    normal: "node_modules/pdfmake/examples/fonts/Roboto-Regular.ttf",
    bold: "node_modules/pdfmake/examples/fonts/Roboto-Medium.ttf",
    italics: "node_modules/pdfmake/examples/fonts/Roboto-Italic.ttf",
    bolditalics: "node_modules/pdfmake/examples/fonts/Roboto-MediumItalic.ttf",
  },
};

export function generateContractPdf({ contractText, signatureImageBuffer, signerName, signedAt }) {
  const printer = new PdfPrinter(fonts);
  const signatureBase64 = `data:image/png;base64,${signatureImageBuffer.toString("base64")}`;

  const docDefinition = {
    content: [
      { text: contractText, fontSize: 10, lineHeight: 1.3 },
      { text: "\n" },
      { text: "Signed electronically:", bold: true, margin: [0, 10, 0, 4] },
      { image: signatureBase64, width: 200 },
      { text: `${signerName} — ${signedAt}`, fontSize: 9, margin: [0, 4, 0, 0] },
    ],
    defaultStyle: { font: "Roboto" },
  };

  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  return new Promise((resolve, reject) => {
    const chunks = [];
    pdfDoc.on("data", (chunk) => chunks.push(chunk));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test functions/test/pdf.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test for `submitSignatureLogic`**

Create `functions/test/submitSignature.test.js`:

```js
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/admin.js";
import { submitSignatureLogic } from "../submitSignature.js";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

beforeEach(async () => {
  await db.recursiveDelete(db.collection("jobs"));
  await db.recursiveDelete(db.collection("documentLinks"));
  await db.collection("jobs").doc("job-1").set({
    status: "CONTRACT_SENT", customerName: "Jane Doe", email: "jane@example.com",
  });
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").set({
    status: "SENT",
    contractText: "Test contract text.",
    bidAmount: 10000,
    scopeOfWork: "Build a deck.",
    depositPercent: 30,
    token: "tok-1",
    sentAt: new Date(),
  });
  await db.collection("documentLinks").doc("tok-1").set({ jobId: "job-1", kind: "contract", createdAt: new Date() });
});

test("signs the contract, generates a PDF, and advances the job", async () => {
  let sentEmail = null;
  await submitSignatureLogic(
    { token: "tok-1", signerName: "Jane Doe", signatureDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    { "user-agent": "test-agent" },
    { sendEmailFn: async (opts) => { sentEmail = opts; } }
  );

  const contractSnap = await db.collection("jobs").doc("job-1").collection("contract").doc("details").get();
  assert.equal(contractSnap.data().status, "SIGNED");
  assert.equal(contractSnap.data().signerName, "Jane Doe");
  assert.equal(contractSnap.data().signatureImagePath, "jobs/job-1/contract/signature.png");
  assert.equal(contractSnap.data().pdfPath, "jobs/job-1/contract/signed.pdf");
  assert.equal(contractSnap.data().signerUserAgent, "test-agent");

  const jobSnap = await db.collection("jobs").doc("job-1").get();
  assert.equal(jobSnap.data().status, "CONTRACT_SIGNED");

  assert.equal(sentEmail.to, "jane@example.com");
  assert.equal(sentEmail.attachments[0].filename, "signed-contract.pdf");
});

test("rejects an already-signed contract", async () => {
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").update({ status: "SIGNED" });
  await assert.rejects(
    submitSignatureLogic(
      { token: "tok-1", signerName: "Jane Doe", signatureDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
      {},
      { sendEmailFn: async () => {} }
    ),
    /already been signed/
  );
});

test("rejects an unknown token", async () => {
  await assert.rejects(
    submitSignatureLogic(
      { token: "does-not-exist", signerName: "Jane Doe", signatureDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
      {},
      { sendEmailFn: async () => {} }
    ),
    /Invalid or unknown token/
  );
});

test("rejects a missing signerName", async () => {
  await assert.rejects(
    submitSignatureLogic(
      { token: "tok-1", signatureDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
      {},
      { sendEmailFn: async () => {} }
    )
  );
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm run test:functions`
Expected: FAIL with "Cannot find module '../submitSignature.js'"

- [ ] **Step 7: Write the implementation**

Create `functions/submitSignature.js`:

```js
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import cors from "cors";
import { db, bucket } from "./lib/admin.js";
import { generateContractPdf } from "./lib/pdf.js";
import { sendEmail } from "./lib/email.js";

const corsHandler = cors({ origin: true });
const resendApiKey = defineSecret("RESEND_API_KEY");

export async function submitSignatureLogic(data, headers, deps = {}) {
  const { sendEmailFn = sendEmail } = deps;
  const { token, signerName, signatureDataUrl } = data;
  if (!token || !signerName || !signatureDataUrl) {
    throw new Error("Missing token, signerName, or signatureDataUrl.");
  }

  const linkSnap = await db.collection("documentLinks").doc(token).get();
  if (!linkSnap.exists) {
    throw new Error("Invalid or unknown token.");
  }
  const { jobId } = linkSnap.data();

  const contractRef = db.collection("jobs").doc(jobId).collection("contract").doc("details");
  const contractSnap = await contractRef.get();
  const contract = contractSnap.data();
  if (contract.status === "SIGNED") {
    throw new Error("This contract has already been signed.");
  }

  const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, "");
  const signatureBuffer = Buffer.from(base64Data, "base64");

  const signatureImagePath = `jobs/${jobId}/contract/signature.png`;
  await bucket.file(signatureImagePath).save(signatureBuffer, { contentType: "image/png" });

  const signedAt = new Date();
  const signedAtDisplay = signedAt.toLocaleDateString("en-US");

  const pdfBuffer = await generateContractPdf({
    contractText: contract.contractText,
    signatureImageBuffer: signatureBuffer,
    signerName,
    signedAt: signedAtDisplay,
  });

  const pdfPath = `jobs/${jobId}/contract/signed.pdf`;
  await bucket.file(pdfPath).save(pdfBuffer, { contentType: "application/pdf" });

  await contractRef.update({
    status: "SIGNED",
    signedAt,
    signerName,
    signatureImagePath,
    pdfPath,
    signerIp: headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? null,
    signerUserAgent: headers["user-agent"] ?? null,
  });

  await db.collection("jobs").doc(jobId).update({ status: "CONTRACT_SIGNED" });

  const jobSnap = await db.collection("jobs").doc(jobId).get();
  const job = jobSnap.data();

  await sendEmailFn({
    to: job.email,
    subject: "Your signed contract — Decked Out WNC",
    html: "<p>Thank you for signing! Your signed contract is attached.</p>",
    attachments: [{ filename: "signed-contract.pdf", content: pdfBuffer.toString("base64") }],
  });

  return { ok: true };
}

export const submitSignature = onRequest({ secrets: [resendApiKey] }, (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }
    try {
      const result = await submitSignatureLogic(req.body, req.headers);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
});
```

Modify `functions/index.js`:

```js
export { sendContract } from "./sendContract.js";
export { getContractByToken } from "./getContractByToken.js";
export { submitSignature } from "./submitSignature.js";
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test:functions`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add functions/lib/pdf.js functions/test/pdf.test.js functions/submitSignature.js functions/test/submitSignature.test.js functions/index.js
git commit -m "feat: add PDF generation and submitSignature Cloud Function"
```

---

### Task 7: Staff resend/view actions

**Files:**
- Create: `functions/contractActions.js`
- Create: `functions/test/contractActions.test.js`
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `db`, `bucket` (Task 2), `requireStaff` (Task 4), `sendEmail` (Task 4).
- Produces: `resendContractLinkLogic`, `resendContractPdfLogic`, `getContractPdfUrlLogic` (each `(data, uid, deps)`), and the exported `resendContractLink`, `resendContractPdf`, `getContractPdfUrl` callables. Used by Task 8's staff UI.

- [ ] **Step 1: Write the failing tests**

Create `functions/test/contractActions.test.js`:

```js
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, bucket } from "../lib/admin.js";
import { resendContractLinkLogic, resendContractPdfLogic, getContractPdfUrlLogic } from "../contractActions.js";

beforeEach(async () => {
  await db.recursiveDelete(db.collection("jobs"));
  await db.recursiveDelete(db.collection("users"));
  await db.collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
  await db.collection("users").doc("crew-uid").set({ role: "crew", name: "Crew Person" });
  await db.collection("jobs").doc("job-1").set({
    status: "CONTRACT_SENT", customerName: "Jane Doe", email: "jane@example.com",
  });
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").set({
    status: "SENT", token: "tok-1",
  });
});

test("resendContractLinkLogic re-sends the signing link email for an unsigned contract", async () => {
  let sentEmail = null;
  await resendContractLinkLogic({ jobId: "job-1" }, "staff-uid", {
    sendEmailFn: async (opts) => { sentEmail = opts; },
  });
  assert.equal(sentEmail.to, "jane@example.com");
  assert.ok(sentEmail.html.includes("tok-1"));
});

test("resendContractLinkLogic rejects a non-staff caller", async () => {
  await assert.rejects(
    resendContractLinkLogic({ jobId: "job-1" }, "crew-uid", { sendEmailFn: async () => {} })
  );
});

test("resendContractLinkLogic rejects an already-signed contract", async () => {
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").update({ status: "SIGNED" });
  await assert.rejects(
    resendContractLinkLogic({ jobId: "job-1" }, "staff-uid", { sendEmailFn: async () => {} })
  );
});

test("resendContractPdfLogic re-sends the PDF for a signed contract", async () => {
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").update({
    status: "SIGNED", pdfPath: "jobs/job-1/contract/signed.pdf",
  });
  await bucket.file("jobs/job-1/contract/signed.pdf").save(Buffer.from("%PDF-fake"), { contentType: "application/pdf" });

  let sentEmail = null;
  await resendContractPdfLogic({ jobId: "job-1" }, "staff-uid", {
    sendEmailFn: async (opts) => { sentEmail = opts; },
  });
  assert.equal(sentEmail.to, "jane@example.com");
  assert.equal(sentEmail.attachments[0].filename, "signed-contract.pdf");
});

test("resendContractPdfLogic rejects a contract that hasn't been signed yet", async () => {
  await assert.rejects(
    resendContractPdfLogic({ jobId: "job-1" }, "staff-uid", { sendEmailFn: async () => {} })
  );
});

test("getContractPdfUrlLogic mints a fresh URL for a signed contract", async () => {
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").update({
    status: "SIGNED", pdfPath: "jobs/job-1/contract/signed.pdf",
  });
  const result = await getContractPdfUrlLogic({ jobId: "job-1" }, "staff-uid", {
    mintUrlFn: async (path) => `https://example.com/mock?path=${path}`,
  });
  assert.ok(result.url.includes("signed.pdf"));
});

test("getContractPdfUrlLogic rejects a non-staff caller", async () => {
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").update({ status: "SIGNED" });
  await assert.rejects(
    getContractPdfUrlLogic({ jobId: "job-1" }, "crew-uid", { mintUrlFn: async () => "x" })
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:functions`
Expected: FAIL with "Cannot find module '../contractActions.js'"

- [ ] **Step 3: Write the implementation**

Create `functions/contractActions.js`:

```js
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db, bucket } from "./lib/admin.js";
import { requireStaff } from "./lib/auth.js";
import { sendEmail } from "./lib/email.js";

const resendApiKey = defineSecret("RESEND_API_KEY");
const APP_ORIGIN = process.env.APP_ORIGIN || "http://127.0.0.1:8090";

async function getContractOrThrow(jobId) {
  const jobRef = db.collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const contractRef = jobRef.collection("contract").doc("details");
  const contractSnap = await contractRef.get();
  if (!contractSnap.exists) throw new HttpsError("not-found", "No contract exists for this job.");
  return { job: jobSnap.data(), contract: contractSnap.data() };
}

async function defaultMintUrl(path) {
  const [url] = await bucket.file(path).getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });
  return url;
}

export async function resendContractLinkLogic(data, uid, deps = {}) {
  const { sendEmailFn = sendEmail } = deps;
  await requireStaff(uid);
  const { job, contract } = await getContractOrThrow(data.jobId);
  if (contract.status !== "SENT") {
    throw new HttpsError("failed-precondition", "This contract has already been signed.");
  }
  const signingUrl = `${APP_ORIGIN}/sign.html?token=${contract.token}`;
  await sendEmailFn({
    to: job.email,
    subject: "Your contract from Decked Out WNC",
    html: `<p>Hi ${job.customerName},</p><p>Please review and sign your contract:</p><p><a href="${signingUrl}">${signingUrl}</a></p>`,
  });
  return { ok: true };
}

export async function resendContractPdfLogic(data, uid, deps = {}) {
  const { sendEmailFn = sendEmail } = deps;
  await requireStaff(uid);
  const { job, contract } = await getContractOrThrow(data.jobId);
  if (contract.status !== "SIGNED") {
    throw new HttpsError("failed-precondition", "This contract hasn't been signed yet.");
  }
  const [pdfBuffer] = await bucket.file(contract.pdfPath).download();
  await sendEmailFn({
    to: job.email,
    subject: "Your signed contract — Decked Out WNC",
    html: "<p>Here is your signed contract, resent as requested.</p>",
    attachments: [{ filename: "signed-contract.pdf", content: pdfBuffer.toString("base64") }],
  });
  return { ok: true };
}

export async function getContractPdfUrlLogic(data, uid, deps = {}) {
  const { mintUrlFn = defaultMintUrl } = deps;
  await requireStaff(uid);
  const { contract } = await getContractOrThrow(data.jobId);
  if (contract.status !== "SIGNED") {
    throw new HttpsError("failed-precondition", "This contract hasn't been signed yet.");
  }
  const url = await mintUrlFn(contract.pdfPath);
  return { url };
}

export const resendContractLink = onCall({ secrets: [resendApiKey] }, (request) =>
  resendContractLinkLogic(request.data, request.auth?.uid)
);
export const resendContractPdf = onCall({ secrets: [resendApiKey] }, (request) =>
  resendContractPdfLogic(request.data, request.auth?.uid)
);
export const getContractPdfUrl = onCall((request) =>
  getContractPdfUrlLogic(request.data, request.auth?.uid)
);
```

Modify `functions/index.js`:

```js
export { sendContract } from "./sendContract.js";
export { getContractByToken } from "./getContractByToken.js";
export { submitSignature } from "./submitSignature.js";
export { resendContractLink, resendContractPdf, getContractPdfUrl } from "./contractActions.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:functions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add functions/contractActions.js functions/test/contractActions.test.js functions/index.js
git commit -m "feat: add resendContractLink, resendContractPdf, getContractPdfUrl Cloud Functions"
```

---

### Task 8: Staff UI — Contract section on Job Detail

**Files:**
- Modify: `index.html`
- Modify: `js/firebase-config.js`
- Create: `js/contracts.js`
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `sendContract`, `resendContractLink`, `resendContractPdf`, `getContractPdfUrl` (Task 4, Task 7 — called via Firebase callable SDK, not directly).
- Produces: `listContract(jobId, callback)`, `sendContract({jobId, bidAmount, scopeOfWork, depositPercent})`, `resendContractLink(jobId)`, `resendContractPdf(jobId)`, `getContractPdfUrl(jobId)` — all exported from `js/contracts.js`.

- [ ] **Step 1: Wire the Functions SDK into `firebase-config.js`**

Modify `js/firebase-config.js`:

```js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

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
export const functions = getFunctions(app);

if (
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
```

- [ ] **Step 2: Write the contracts data layer**

Create `js/contracts.js`:

```js
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, functions } from "./firebase-config.js";

export async function sendContract({ jobId, bidAmount, scopeOfWork, depositPercent }) {
  const callable = httpsCallable(functions, "sendContract");
  await callable({ jobId, bidAmount: Number(bidAmount), scopeOfWork, depositPercent: Number(depositPercent) });
}

export async function resendContractLink(jobId) {
  const callable = httpsCallable(functions, "resendContractLink");
  await callable({ jobId });
}

export async function resendContractPdf(jobId) {
  const callable = httpsCallable(functions, "resendContractPdf");
  await callable({ jobId });
}

export async function getContractPdfUrl(jobId) {
  const callable = httpsCallable(functions, "getContractPdfUrl");
  const result = await callable({ jobId });
  return result.data.url;
}

export function listContract(jobId, callback) {
  const ref = doc(db, "jobs", jobId, "contract", "details");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : null),
    (error) => {
      console.error("listContract snapshot error:", error);
      callback(null);
    }
  );
}
```

- [ ] **Step 3: Add the Contract section markup**

Modify `index.html` — insert this block right after the existing `<p id="receipts-staff-only-notice" hidden>...</p>` line (before `<div id="activity-section">`):

```html
      <div id="contract-section">
        <h3>Contract</h3>
        <div id="contract-status"></div>
        <form id="send-contract-form" hidden>
          <input type="number" id="contract-bid-amount" placeholder="Bid amount" step="0.01" min="0" required />
          <textarea id="contract-scope" placeholder="Scope of work" rows="3" required></textarea>
          <input type="number" id="contract-deposit-percent" placeholder="Deposit %" value="30" min="0" max="100" required />
          <button type="submit" class="btn-primary">Send Contract</button>
        </form>
      </div>
      <p id="contract-staff-only-notice" hidden>Contract details are only visible to staff.</p>
```

Also modify the existing shared form-layout CSS selectors (find `#new-lead-form, #add-receipt-form, #edit-job-form { ... }` and its sibling rules) to include `#send-contract-form`:

```css
    #new-lead-form, #add-receipt-form, #edit-job-form, #send-contract-form {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      align-items: center;
    }
    #new-lead-form input, #add-receipt-form input, #edit-job-form input, #send-contract-form input { flex: 1 1 160px; }
    #new-lead-form textarea, #edit-job-form textarea, #send-contract-form textarea { flex-basis: 100%; min-height: 60px; }
    #new-lead-form button, #add-receipt-form button, #edit-job-form button, #send-contract-form button { flex: 0 0 auto; }
    #add-receipt-form .photo-capture-btn,
    #add-receipt-form #receipt-file-status { flex-basis: 100%; }
    #edit-job-form[hidden], #send-contract-form[hidden] { display: none; }
```

(The `#edit-job-form[hidden]` override already exists from the job-editing feature — extend that same rule to cover `#send-contract-form[hidden]` too, since the `display: flex` rule above would otherwise defeat the `hidden` attribute exactly like it did before.)

Add a small status-text style near the other job-detail rules:

```css
    #contract-status { margin: 0.5rem 0 0.75rem; font-size: 0.92rem; }
    #contract-status .btn-quiet { margin-top: 0.5rem; margin-right: 0.5rem; }
```

- [ ] **Step 4: Wire up `main.js`**

Modify `js/main.js` — add the import:

```js
import { sendContract, resendContractLink, resendContractPdf, getContractPdfUrl, listContract } from "./contracts.js";
```

Add element references alongside the other job-detail refs:

```js
const contractSection = document.getElementById("contract-section");
const contractStatus = document.getElementById("contract-status");
const contractStaffOnlyNotice = document.getElementById("contract-staff-only-notice");
const sendContractForm = document.getElementById("send-contract-form");
```

Add state alongside `let unsubscribeActivity = null;`:

```js
let unsubscribeContract = null;
```

Add this function near `renderReceipts`/`renderActivity`:

```js
function renderContract(contract) {
  if (currentRole !== "staff") {
    contractSection.hidden = true;
    contractStaffOnlyNotice.hidden = false;
    return;
  }
  contractSection.hidden = false;
  contractStaffOnlyNotice.hidden = true;

  if (!contract) {
    sendContractForm.hidden = currentJob.status !== "WON";
    contractStatus.textContent = currentJob.status === "WON"
      ? "No contract sent yet."
      : "A contract can be sent once this job is Won.";
    return;
  }

  sendContractForm.hidden = true;
  contractStatus.innerHTML = "";

  if (contract.status === "SENT") {
    const p = document.createElement("p");
    p.textContent = `Sent to ${currentJob.email} — awaiting signature.`;
    contractStatus.appendChild(p);

    const resendBtn = document.createElement("button");
    resendBtn.type = "button";
    resendBtn.className = "btn-quiet";
    resendBtn.textContent = "Resend Signing Link";
    resendBtn.addEventListener("click", async () => {
      appError.textContent = "";
      try {
        await resendContractLink(currentJobId);
      } catch (err) {
        appError.textContent = "Could not resend link: " + err.message;
      }
    });
    contractStatus.appendChild(resendBtn);
    return;
  }

  if (contract.status === "SIGNED") {
    const signedDate = contract.signedAt?.toDate
      ? contract.signedAt.toDate().toLocaleDateString("en-US")
      : "";
    const p = document.createElement("p");
    p.textContent = `Signed by ${contract.signerName} on ${signedDate}.`;
    contractStatus.appendChild(p);

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "btn-quiet";
    viewBtn.textContent = "View/Download PDF";
    viewBtn.addEventListener("click", async () => {
      appError.textContent = "";
      try {
        const url = await getContractPdfUrl(currentJobId);
        window.open(url, "_blank");
      } catch (err) {
        appError.textContent = "Could not open PDF: " + err.message;
      }
    });
    contractStatus.appendChild(viewBtn);

    const resendPdfBtn = document.createElement("button");
    resendPdfBtn.type = "button";
    resendPdfBtn.className = "btn-quiet";
    resendPdfBtn.textContent = "Resend Signed PDF";
    resendPdfBtn.addEventListener("click", async () => {
      appError.textContent = "";
      try {
        await resendContractPdf(currentJobId);
      } catch (err) {
        appError.textContent = "Could not resend PDF: " + err.message;
      }
    });
    contractStatus.appendChild(resendPdfBtn);
  }
}
```

Modify `openJobDetail(job)` — add contract wiring alongside the existing activity wiring:

```js
  if (unsubscribeContract) unsubscribeContract();
  unsubscribeContract = listContract(currentJobId, renderContract);
```

Modify `closeJobDetail()` — add cleanup alongside the existing unsubscribe calls:

```js
  if (unsubscribeContract) {
    unsubscribeContract();
    unsubscribeContract = null;
  }
```

Add the form submit handler near the other form handlers:

```js
sendContractForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  appError.textContent = "";
  const bidAmount = document.getElementById("contract-bid-amount").value;
  const scopeOfWork = document.getElementById("contract-scope").value;
  const depositPercent = document.getElementById("contract-deposit-percent").value;
  try {
    await sendContract({ jobId: currentJobId, bidAmount, scopeOfWork, depositPercent });
    currentJob = { ...currentJob, status: "CONTRACT_SENT" };
    sendContractForm.reset();
  } catch (err) {
    appError.textContent = "Could not send contract: " + err.message;
  }
});
```

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run emulators` (in one terminal) and serve the app statically (e.g. `python -m http.server 8090`), then in another terminal seed a WON job (via the Firestore emulator REST API or by advancing a seeded lead through the pipeline in the UI). Sign in as staff, open that job's detail page, confirm:
- The Contract section shows "No contract sent yet." and the Send Contract form.
- Filling in Bid Amount / Scope of Work / Deposit % and submitting shows "Sent to `{email}` — awaiting signature." with a Resend Signing Link button, and the job's pipeline badge now shows `CONTRACT_SENT`.
- Signing in as a crew user (any job) shows "Contract details are only visible to staff." instead.

Expected: all of the above match. This step doesn't yet verify the customer's signing page (Task 9) or a real sent email — that happens in Task 9's verification and the final end-to-end check.

- [ ] **Step 6: Commit**

```bash
git add index.html js/firebase-config.js js/contracts.js js/main.js
git commit -m "feat: add staff Contract section to Job Detail"
```

---

### Task 9: Customer-facing signing page

**Files:**
- Create: `sign.html`
- Create: `js/sign.js`

**Interfaces:**
- Consumes: `getContractByToken`, `submitSignature` (Task 5, Task 6 — called via plain `fetch`, not the Functions SDK, since the customer has no Firebase Auth session at all).

- [ ] **Step 1: Create the signing page**

Create `sign.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign Your Contract — Decked Out WNC</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/signature_pad/4.1.7/signature_pad.umd.min.js"></script>
  <style>
    :root {
      --bark: #2B241C; --plank: #DCD0B8; --cedar: #A34E2C; --cedar-dark: #7E3A20;
      --slate: #6B6558; --rust: #7A3226; --chalk: #F5F1E6;
      --r-btn: 6px; --r-card: 12px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--plank); color: var(--bark);
      font-family: 'Public Sans', system-ui, sans-serif;
    }
    h1, h2 { font-family: 'Barlow Condensed', system-ui, sans-serif; }
    .page { max-width: 640px; margin: 0 auto; padding: 2rem 1.25rem; }
    .card {
      background: var(--chalk); border: 1px solid rgba(43,36,28,.15);
      border-radius: var(--r-card); padding: 1.5rem; box-shadow: 0 1px 3px rgba(43,36,28,.08);
    }
    #contract-text { white-space: pre-wrap; font-size: 0.92rem; line-height: 1.5; margin-bottom: 1.25rem; }
    #signature-pad-canvas {
      border: 1.5px solid var(--slate); border-radius: var(--r-btn);
      width: 100%; height: 180px; touch-action: none;
    }
    input[type="text"] {
      width: 100%; padding: 10px 12px; border: 1px solid rgba(43,36,28,.25);
      border-radius: var(--r-btn); font-family: inherit; font-size: 0.95rem; margin: 0.75rem 0;
    }
    button {
      font-family: inherit; font-weight: 700; border: none; border-radius: var(--r-btn);
      cursor: pointer; padding: 10px 16px; font-size: 0.9rem; min-height: 44px;
    }
    .btn-primary { background: var(--cedar); color: var(--chalk); width: 100%; }
    .btn-primary:hover { background: var(--cedar-dark); }
    .btn-quiet { background: none; border: 1.5px solid rgba(43,36,28,.25); color: var(--bark); margin-top: 0.5rem; }
    #error { color: var(--rust); font-weight: 600; min-height: 1.2em; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <div class="page">
    <h1>Decked Out WNC</h1>
    <div class="card">
      <div id="loading-state">Loading your contract…</div>

      <div id="invalid-state" hidden>
        <p>This link isn't valid. Please contact Decked Out WNC if you believe this is a mistake.</p>
      </div>

      <div id="signed-state" hidden>
        <h2>Already Signed</h2>
        <p id="signed-summary"></p>
        <a id="download-link" class="btn-quiet" href="#" target="_blank"
           style="display:inline-block; text-decoration:none; text-align:center;">Download Your Copy</a>
      </div>

      <div id="unsigned-state" hidden>
        <h2>Please Review and Sign</h2>
        <div id="contract-text"></div>
        <canvas id="signature-pad-canvas"></canvas>
        <button type="button" id="clear-signature-btn" class="btn-quiet">Clear Signature</button>
        <input type="text" id="signer-name" placeholder="Type your full name" required />
        <p id="error"></p>
        <button type="button" id="submit-signature-btn" class="btn-primary">Sign &amp; Submit</button>
      </div>

      <div id="thank-you-state" hidden>
        <h2>You're All Set</h2>
        <p>Thanks for signing — your copy is on its way to your email.</p>
      </div>
    </div>
  </div>

  <script src="js/sign.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: Write the page's JS**

Create `js/sign.js`:

```js
const FUNCTIONS_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://127.0.0.1:5001/deckedoutwnc/us-central1"
  : "https://us-central1-deckedoutwnc.cloudfunctions.net";

const token = new URLSearchParams(location.search).get("token");

const loadingState = document.getElementById("loading-state");
const invalidState = document.getElementById("invalid-state");
const signedState = document.getElementById("signed-state");
const unsignedState = document.getElementById("unsigned-state");
const thankYouState = document.getElementById("thank-you-state");
const contractTextEl = document.getElementById("contract-text");
const signedSummaryEl = document.getElementById("signed-summary");
const downloadLinkEl = document.getElementById("download-link");
const signerNameInput = document.getElementById("signer-name");
const errorEl = document.getElementById("error");
const submitBtn = document.getElementById("submit-signature-btn");
const clearBtn = document.getElementById("clear-signature-btn");

function showState(el) {
  for (const s of [loadingState, invalidState, signedState, unsignedState, thankYouState]) {
    s.hidden = s !== el;
  }
}

let signaturePad;

async function init() {
  if (!token) {
    showState(invalidState);
    return;
  }
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/getContractByToken?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      showState(invalidState);
      return;
    }
    const data = await res.json();
    if (data.status === "SIGNED") {
      signedSummaryEl.textContent = `Signed on ${new Date(data.signedAt).toLocaleDateString("en-US")}.`;
      downloadLinkEl.href = data.pdfUrl;
      showState(signedState);
      return;
    }
    contractTextEl.textContent = data.contractText;
    showState(unsignedState);
    signaturePad = new SignaturePad(document.getElementById("signature-pad-canvas"));
  } catch (err) {
    showState(invalidState);
  }
}

clearBtn.addEventListener("click", () => signaturePad?.clear());

submitBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  const signerName = signerNameInput.value.trim();
  if (!signerName) {
    errorEl.textContent = "Please type your full name.";
    return;
  }
  if (!signaturePad || signaturePad.isEmpty()) {
    errorEl.textContent = "Please sign above before submitting.";
    return;
  }
  submitBtn.disabled = true;
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/submitSignature`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        signerName,
        signatureDataUrl: signaturePad.toDataURL("image/png"),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Something went wrong. Please try again.");
    }
    showState(thankYouState);
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

init();
```

- [ ] **Step 3: Manually verify in the browser**

With the emulators and static server running (from Task 8's verification), and the Functions emulator also running (`npm run emulators` now starts it per Task 2's config):
1. From the staff UI, send a contract for a test job using a real email address you control.
2. Copy the signing URL (`sign.html?token=...`) either from the local Resend dashboard's sent-email log, or by reading the `token` field directly off the `documentLinks` doc in the Firestore emulator UI at `http://127.0.0.1:4000`.
3. Open that URL directly. Confirm the contract text renders, the signature pad accepts drawing input, and "Clear Signature" works.
4. Type a name, sign, and submit. Confirm the "You're All Set" state appears.
5. Reload the same URL. Confirm it now shows "Already Signed" with a working download link.
6. Back in the staff UI, confirm the job's Contract section now shows "Signed by `{name}` on `{date}`" with working View/Download PDF and Resend Signed PDF buttons.

Expected: all of the above work end-to-end against the local emulators.

- [ ] **Step 4: Commit**

```bash
git add sign.html js/sign.js
git commit -m "feat: add customer-facing contract signing page"
```

---

### Task 10: Remove contract-driven transitions from the manual dropdown

**Files:**
- Modify: `js/pipeline.js`
- Modify: `tests/unit/pipeline.test.js`
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `canTransition` (existing).
- Produces: `canManuallyTransition(from, to)` — used by `js/main.js`'s `buildJobCard` in place of `canTransition` for populating the "Advance to…" dropdown.

- [ ] **Step 1: Write the failing test**

Modify `tests/unit/pipeline.test.js` — add these tests (the file currently imports `{ STAGES, canTransition }`; update the import too):

```js
import { STAGES, canTransition, canManuallyTransition } from "../../js/pipeline.js";
```

```js
test("canManuallyTransition excludes the two contract-driven transitions", () => {
  assert.equal(canManuallyTransition("WON", "CONTRACT_SENT"), false);
  assert.equal(canManuallyTransition("CONTRACT_SENT", "CONTRACT_SIGNED"), false);
});

test("canManuallyTransition still allows every other valid transition", () => {
  assert.equal(canManuallyTransition("LEAD_IN", "BID_SCHEDULED"), true);
  assert.equal(canManuallyTransition("CONTRACT_SIGNED", "DEPOSIT_INVOICED"), true);
  assert.equal(canManuallyTransition("BID_GIVEN", "LOST"), true);
});

test("canManuallyTransition still rejects invalid transitions", () => {
  assert.equal(canManuallyTransition("LEAD_IN", "COMPLETE"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL with "canManuallyTransition is not a function" (or a named-export import error)

- [ ] **Step 3: Write the implementation**

Modify `js/pipeline.js` — add after the existing `canTransition` function:

```js
const MANUALLY_EXCLUDED_TRANSITIONS = new Set(["WON:CONTRACT_SENT", "CONTRACT_SENT:CONTRACT_SIGNED"]);

export function canManuallyTransition(from, to) {
  return canTransition(from, to) && !MANUALLY_EXCLUDED_TRANSITIONS.has(`${from}:${to}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: Update `main.js` to use it**

Modify `js/main.js` — update the import:

```js
import { STAGES, canManuallyTransition } from "./pipeline.js";
```

And in `buildJobCard`, change:

```js
    const nextStages = STAGES.filter((s) => canTransition(job.status, s));
```

to:

```js
    const nextStages = STAGES.filter((s) => canManuallyTransition(job.status, s));
```

- [ ] **Step 6: Manually verify in the browser**

With the app running, open a WON job's card in the pipeline list as staff. Confirm the "Advance to…" dropdown no longer offers `CONTRACT_SENT` as an option. Advance a job to `CONTRACT_SENT` via the new Send Contract flow (Task 8), then confirm its dropdown no longer offers `CONTRACT_SIGNED` either — only sending/signing a real contract can produce those transitions now.

- [ ] **Step 7: Commit**

```bash
git add js/pipeline.js tests/unit/pipeline.test.js js/main.js
git commit -m "feat: remove contract-driven stage transitions from the manual Advance-to dropdown"
```

---

## Final verification (after all tasks)

- [ ] Run the full test suite: `npm run test:unit && npm run test:rules && npm run test:functions` — all green.
- [ ] Do one real end-to-end run using your own email address as the "customer": send a contract, confirm the email actually arrives in your inbox (not just that the mocked test passed), sign it from the emailed link, confirm the signed-copy email arrives with a real PDF attachment that opens correctly, and confirm the staff UI's "View/Download PDF" and "Resend Signed PDF" both work against that real signed contract.
- [ ] Confirm a crew-role login sees "Contract details are only visible to staff." on Job Detail and cannot see the Contract section at all.
- [ ] Update the Obsidian vault (`decisions.md`, `architecture.md`, `known-issues.md`, `sessions/`) to reflect what was actually built, same as prior phases.
