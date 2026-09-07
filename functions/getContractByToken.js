import { onRequest } from "firebase-functions/v2/https";
import cors from "cors";
import { db, bucket } from "./lib/admin.js";

const corsHandler = cors({ origin: true });

async function defaultMintUrl(path) {
  const [url] = await bucket.file(path).getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000,
  });
  return url;
}

export async function getContractByTokenLogic(token, deps = {}) {
  const { mintUrlFn = defaultMintUrl } = deps;
  if (!token) {
    throw new Error("Missing token.");
  }
  const linkSnap = await db.collection("documentLinks").doc(token).get();
  if (!linkSnap.exists) {
    throw new Error("Invalid or unknown link.");
  }
  const link = linkSnap.data();
  if (link.kind !== "contract") {
    throw new Error("Invalid or unknown link.");
  }
  const { jobId } = link;

  const jobSnap = await db.collection("jobs").doc(jobId).get();
  const contractSnap = await db.collection("jobs").doc(jobId).collection("contract").doc("details").get();
  if (!jobSnap.exists || !contractSnap.exists) {
    throw new Error("Invalid or unknown link.");
  }
  const job = jobSnap.data();
  const contract = contractSnap.data();
  if (contract.token !== token) {
    throw new Error("Invalid or unknown link.");
  }

  if (contract.status === "SIGNED") {
    const pdfUrl = await mintUrlFn(contract.pdfPath);
    return {
      status: "SIGNED",
      customerName: job.customerName,
      signedAt: contract.signedAt.toDate().toISOString(),
      pdfUrl,
    };
  }

  return {
    status: "SENT",
    customerName: job.customerName,
    contractText: contract.contractText,
  };
}

export const getContractByToken = onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const token = req.method === "GET" ? req.query?.token : req.body?.token;
      const result = await getContractByTokenLogic(token);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
});
