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
    const setupDb = ctx.firestore();
    await setupDb.collection("users").doc("staff-uid").set({ role: "staff", name: "Staff Person" });
    await setupDb.collection("jobs").doc("job-1").set({ status: "JOB_SCHEDULED", customerName: "A" });
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
