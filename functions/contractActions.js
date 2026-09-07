import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db, bucket } from "./lib/admin.js";
import { requireStaff } from "./lib/auth.js";
import { sendEmail } from "./lib/email.js";

const resendApiKey = defineSecret("RESEND_API_KEY");
const APP_ORIGIN = process.env.APP_ORIGIN || "http://127.0.0.1:8090";

async function getContractOrThrow(jobId) {
  const jobRef = db.collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const contractRef = jobRef.collection("contract").doc("details");
  const contractSnap = await contractRef.get();
  if (!contractSnap.exists) throw new HttpsError("not-found", "No contract exists for this job.");
  return { job: jobSnap.data(), contract: contractSnap.data() };
}

async function defaultMintUrl(path) {
  const [url] = await bucket.file(path).getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });
  return url;
}

export async function resendContractLinkLogic(data, uid, deps = {}) {
  const { sendEmailFn = sendEmail } = deps;
  await requireStaff(uid);
  const { job, contract } = await getContractOrThrow(data.jobId);
  if (contract.status !== "SENT") {
    throw new HttpsError("failed-precondition", "This contract has already been signed.");
  }
  const signingUrl = `${APP_ORIGIN}/sign.html?token=${contract.token}`;
  await sendEmailFn({
    to: job.email,
    subject: "Your contract from Decked Out WNC",
    html: `<p>Hi ${job.customerName},</p><p>Please review and sign your contract:</p><p><a href="${signingUrl}">${signingUrl}</a></p>`,
  });
  return { ok: true };
}

export async function resendContractPdfLogic(data, uid, deps = {}) {
  const { sendEmailFn = sendEmail } = deps;
  await requireStaff(uid);
  const { job, contract } = await getContractOrThrow(data.jobId);
  if (contract.status !== "SIGNED") {
    throw new HttpsError("failed-precondition", "This contract hasn't been signed yet.");
  }
  const [pdfBuffer] = await bucket.file(contract.pdfPath).download();
  await sendEmailFn({
    to: job.email,
    subject: "Your signed contract — Decked Out WNC",
    html: "<p>Here is your signed contract, resent as requested.</p>",
    attachments: [{ filename: "signed-contract.pdf", content: pdfBuffer.toString("base64") }],
  });
  return { ok: true };
}

export async function getContractPdfUrlLogic(data, uid, deps = {}) {
  const { mintUrlFn = defaultMintUrl } = deps;
  await requireStaff(uid);
  const { contract } = await getContractOrThrow(data.jobId);
  if (contract.status !== "SIGNED") {
    throw new HttpsError("failed-precondition", "This contract hasn't been signed yet.");
  }
  const url = await mintUrlFn(contract.pdfPath);
  return { url };
}

export const resendContractLink = onCall({ secrets: [resendApiKey] }, (request) =>
  resendContractLinkLogic(request.data, request.auth?.uid)
);
export const resendContractPdf = onCall({ secrets: [resendApiKey] }, (request) =>
  resendContractPdfLogic(request.data, request.auth?.uid)
);
export const getContractPdfUrl = onCall((request) =>
  getContractPdfUrlLogic(request.data, request.auth?.uid)
);
