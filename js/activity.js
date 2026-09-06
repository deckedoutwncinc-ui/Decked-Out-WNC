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

export async function postActivity(jobId, { text, file }) {
  let photoUrl = null;
  if (file) {
    const path = `jobs/${jobId}/activity/${Date.now()}_${file.name}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    photoUrl = await getDownloadURL(fileRef);
  }

  const docRef = await addDoc(collection(db, "jobs", jobId, "activity"), {
    text: text || null,
    photoUrl,
    authorUid: auth.currentUser.uid,
    authorEmail: auth.currentUser.email,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export function listActivity(jobId, callback) {
  const q = query(
    collection(db, "jobs", jobId, "activity"),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (error) => {
      console.error("listActivity snapshot error:", error);
      callback([]);
    }
  );
}
