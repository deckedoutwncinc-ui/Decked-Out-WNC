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
