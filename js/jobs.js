import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { canTransition } from "./pipeline.js";

export async function createLead(data) {
  const ref = await addDoc(collection(db, "jobs"), {
    ...data,
    status: "LEAD_IN",
    stageEnteredAt: { LEAD_IN: serverTimestamp() },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateJobStage(jobId, currentStatus, newStatus) {
  if (!canTransition(currentStatus, newStatus)) {
    throw new Error(`Cannot transition from ${currentStatus} to ${newStatus}`);
  }
  await updateDoc(doc(db, "jobs", jobId), {
    status: newStatus,
    [`stageEnteredAt.${newStatus}`]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function listJobs(callback) {
  const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
