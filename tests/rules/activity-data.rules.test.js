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
