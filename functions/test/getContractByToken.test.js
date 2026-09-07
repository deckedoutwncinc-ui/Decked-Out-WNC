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

test("rejects a link whose kind is not 'contract'", async () => {
  await db.collection("documentLinks").doc("tok-1").set({ jobId: "job-1", kind: "payment", createdAt: new Date() });
  await assert.rejects(getContractByTokenLogic("tok-1"), /Invalid or unknown link/);
});

test("rejects a token that doesn't match the contract's own token", async () => {
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").update({ token: "some-other-token" });
  await assert.rejects(getContractByTokenLogic("tok-1"), /Invalid or unknown link/);
});

test("rejects an orphaned link (no contract doc) with a clean message instead of throwing a raw TypeError", async () => {
  await db.collection("documentLinks").doc("orphan-tok").set({ jobId: "no-such-job", kind: "contract", createdAt: new Date() });
  await assert.rejects(getContractByTokenLogic("orphan-tok"), /Invalid or unknown link/);
});
