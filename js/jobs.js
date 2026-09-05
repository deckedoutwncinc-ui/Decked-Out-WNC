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

// NOTE: this unconstrained query only works for staff. A crew user's read
// will always be denied by firestore.rules (Firestore rejects list queries
// it can't evaluate against the potential result set when the rule needs
// per-document data) — harmless today since crew has no assigned jobs to
// see yet, but Phase 4 (crew scheduling) must switch this to a role-aware
// query: unconstrained for staff, `where("assignedCrew","array-contains",uid)`
// for crew, plus a composite index in firestore.indexes.json.
export function listJobs(callback) {
  const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      console.error("listJobs snapshot error:", error);
      callback([]);
    }
  );
}
