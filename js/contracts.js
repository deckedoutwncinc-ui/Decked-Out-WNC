import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, functions } from "./firebase-config.js";

export async function sendContract({ jobId, bidAmount, scopeOfWork, depositPercent }) {
  const callable = httpsCallable(functions, "sendContract");
  await callable({ jobId, bidAmount: Number(bidAmount), scopeOfWork, depositPercent: Number(depositPercent) });
}

export async function resendContractLink(jobId) {
  const callable = httpsCallable(functions, "resendContractLink");
  await callable({ jobId });
}

export async function resendContractPdf(jobId) {
  const callable = httpsCallable(functions, "resendContractPdf");
  await callable({ jobId });
}

export async function getContractPdfUrl(jobId) {
  const callable = httpsCallable(functions, "getContractPdfUrl");
  const result = await callable({ jobId });
  return result.data.url;
}

export function listContract(jobId, callback) {
  const ref = doc(db, "jobs", jobId, "contract", "details");
  return onSnapshot(
    ref,
    (snap) => callback(snap.exists() ? snap.data() : null),
    (error) => {
      console.error("listContract snapshot error:", error);
      callback(null);
    }
  );
}
