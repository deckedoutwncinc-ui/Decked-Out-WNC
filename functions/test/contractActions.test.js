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
