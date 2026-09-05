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
