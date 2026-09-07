import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import cors from "cors";
import { db, bucket } from "./lib/admin.js";
import { generateContractPdf } from "./lib/pdf.js";
import { sendEmail } from "./lib/email.js";

const corsHandler = cors({ origin: true });
const resendApiKey = defineSecret("RESEND_API_KEY");

export async function submitSignatureLogic(data, headers, deps = {}) {
  const { sendEmailFn = sendEmail } = deps;
  const { token, signerName, signatureDataUrl } = data;
  if (!token || !signerName || !signatureDataUrl) {
    throw new Error("Missing token, signerName, or signatureDataUrl.");
  }

  const linkSnap = await db.collection("documentLinks").doc(token).get();
  if (!linkSnap.exists) {
    throw new Error("Invalid or unknown token.");
  }
  const { jobId } = linkSnap.data();

  const contractRef = db.collection("jobs").doc(jobId).collection("contract").doc("details");
  const contractSnap = await contractRef.get();
  const contract = contractSnap.data();
  if (contract.status === "SIGNED") {
    throw new Error("This contract has already been signed.");
  }

  const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, "");
  const signatureBuffer = Buffer.from(base64Data, "base64");

  const signatureImagePath = `jobs/${jobId}/contract/signature.png`;
  await bucket.file(signatureImagePath).save(signatureBuffer, { contentType: "image/png" });

  const signedAt = new Date();
  const signedAtDisplay = signedAt.toLocaleDateString("en-US");

  const pdfBuffer = await generateContractPdf({
    contractText: contract.contractText,
    signatureImageBuffer: signatureBuffer,
    signerName,
    signedAt: signedAtDisplay,
  });

  const pdfPath = `jobs/${jobId}/contract/signed.pdf`;
  await bucket.file(pdfPath).save(pdfBuffer, { contentType: "application/pdf" });

  await contractRef.update({
    status: "SIGNED",
    signedAt,
    signerName,
    signatureImagePath,
    pdfPath,
    signerIp: headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? null,
    signerUserAgent: headers["user-agent"] ?? null,
  });

  await db.collection("jobs").doc(jobId).update({ status: "CONTRACT_SIGNED" });

  const jobSnap = await db.collection("jobs").doc(jobId).get();
  const job = jobSnap.data();

  await sendEmailFn({
    to: job.email,
    subject: "Your signed contract — Decked Out WNC",
    html: "<p>Thank you for signing! Your signed contract is attached.</p>",
    attachments: [{ filename: "signed-contract.pdf", content: pdfBuffer.toString("base64") }],
  });

  return { ok: true };
}

export const submitSignature = onRequest({ secrets: [resendApiKey] }, (req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }
    try {
      const result = await submitSignatureLogic(req.body, req.headers);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
});
