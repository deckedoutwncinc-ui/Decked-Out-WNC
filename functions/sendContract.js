import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { randomBytes } from "node:crypto";
import { db } from "./lib/admin.js";
import { requireStaff } from "./lib/auth.js";
import { fillContractTemplate } from "./lib/contractTemplate.js";
import { sendEmail } from "./lib/email.js";

const resendApiKey = defineSecret("RESEND_API_KEY");
const APP_ORIGIN = process.env.APP_ORIGIN || "http://127.0.0.1:8090";

export async function sendContractLogic(data, uid, deps = {}) {
  const { sendEmailFn = sendEmail } = deps;
  await requireStaff(uid);

  const { jobId, bidAmount, scopeOfWork, depositPercent } = data;
  if (!jobId || !bidAmount || !scopeOfWork || !depositPercent) {
    throw new HttpsError("invalid-argument", "jobId, bidAmount, scopeOfWork, and depositPercent are required.");
  }

  const jobRef = db.collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    throw new HttpsError("not-found", "Job not found.");
  }
  const job = jobSnap.data();
  if (job.status !== "WON") {
    throw new HttpsError("failed-precondition", "Contract can only be sent for a job in the WON stage.");
  }

  const sentDate = new Date().toLocaleDateString("en-US");
  const contractText = fillContractTemplate({
    customerName: job.customerName,
    address: job.address,
    scopeOfWork,
    bidAmount: Number(bidAmount),
    depositPercent: Number(depositPercent),
    sentDate,
  });

  const token = randomBytes(32).toString("hex");

  await db.collection("documentLinks").doc(token).set({
    jobId,
    kind: "contract",
    createdAt: new Date(),
  });

  await jobRef.collection("contract").doc("details").set({
    status: "SENT",
    bidAmount: Number(bidAmount),
    scopeOfWork,
    depositPercent: Number(depositPercent),
    contractText,
    token,
    sentAt: new Date(),
    signedAt: null,
    signerName: null,
    signatureImagePath: null,
    pdfPath: null,
    signerIp: null,
    signerUserAgent: null,
  });

  await jobRef.update({ status: "CONTRACT_SENT" });

  const signingUrl = `${APP_ORIGIN}/sign.html?token=${token}`;
  try {
    await sendEmailFn({
      to: job.email,
      subject: "Your contract from Decked Out WNC",
      html: `<p>Hi ${job.customerName},</p><p>Please review and sign your contract:</p><p><a href="${signingUrl}">${signingUrl}</a></p>`,
    });
  } catch (err) {
    // The contract, documentLinks entry, and job status are already
    // committed — a failed send email must not report failure for a contract
    // that was in fact created. Staff have "Resend Signing Link" to recover.
    console.error("sendContract: failed to send contract email:", err);
  }

  return { ok: true };
}

export const sendContract = onCall({ secrets: [resendApiKey] }, (request) =>
  sendContractLogic(request.data, request.auth?.uid)
);
