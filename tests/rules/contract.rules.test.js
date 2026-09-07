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
