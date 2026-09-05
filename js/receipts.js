import {
  collection,
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { db, storage, auth } from "./firebase-config.js";

export async function uploadReceipt(jobId, { amount, vendor, date, file }) {
  const path = `jobs/${jobId}/receipts/${Date.now()}_${file.name}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  const fileUrl = await getDownloadURL(fileRef);

  const docRef = await addDoc(collection(db, "jobs", jobId, "receipts"), {
    amount: Number(amount),
    vendor,
    date,
    fileUrl,
    uploadedBy: auth.currentUser.uid,
    uploadedAt: serverTimestamp(),
  });
  return docRef.id;
}

export function listReceipts(jobId, callback) {
  const q = query(
    collection(db, "jobs", jobId, "receipts"),
    orderBy("date", "desc")
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      console.error("listReceipts snapshot error:", error);
      callback([]);
    }
  );
}
