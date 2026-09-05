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
