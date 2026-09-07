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

test("still returns success when the contract email send fails", async () => {
  await sendContractLogic(
    { jobId: "job-1", bidAmount: 10000, scopeOfWork: "Build a 12x14 deck.", depositPercent: 30 },
    "staff-uid",
    { sendEmailFn: async () => { throw new Error("Resend rejected the request."); } }
  );

  const jobSnap = await db.collection("jobs").doc("job-1").get();
  assert.equal(jobSnap.data().status, "CONTRACT_SENT");
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
