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

test("rejects a link whose kind is not 'contract'", async () => {
  await db.collection("documentLinks").doc("tok-1").set({ jobId: "job-1", kind: "payment", createdAt: new Date() });
  await assert.rejects(
    submitSignatureLogic(
      { token: "tok-1", signerName: "Jane Doe", signatureDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
      {},
      { sendEmailFn: async () => {} }
    ),
    /Invalid or unknown token/
  );
});

test("rejects a token that doesn't match the contract's own token", async () => {
  await db.collection("jobs").doc("job-1").collection("contract").doc("details").update({ token: "some-other-token" });
  await assert.rejects(
    submitSignatureLogic(
      { token: "tok-1", signerName: "Jane Doe", signatureDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
      {},
      { sendEmailFn: async () => {} }
    ),
    /Invalid or unknown token/
  );
});

test("rejects an orphaned link (no contract doc) with a clean message instead of throwing a raw TypeError", async () => {
  await db.collection("documentLinks").doc("orphan-tok").set({ jobId: "no-such-job", kind: "contract", createdAt: new Date() });
  await assert.rejects(
    submitSignatureLogic(
      { token: "orphan-tok", signerName: "Jane Doe", signatureDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
      {},
      { sendEmailFn: async () => {} }
    ),
    /Invalid or unknown token/
  );
});

test("still returns success when the confirmation email send fails", async () => {
  await submitSignatureLogic(
    { token: "tok-1", signerName: "Jane Doe", signatureDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` },
    { "user-agent": "test-agent" },
    { sendEmailFn: async () => { throw new Error("Resend rejected the request."); } }
  );

  const contractSnap = await db.collection("jobs").doc("job-1").collection("contract").doc("details").get();
  assert.equal(contractSnap.data().status, "SIGNED");
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
