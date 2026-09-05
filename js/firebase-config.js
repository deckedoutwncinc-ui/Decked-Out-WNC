import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCsn4EEuK0KAkeVKyUTQoAqGV48_dbqdFg",
  authDomain: "deckedoutwnc.firebaseapp.com",
  projectId: "deckedoutwnc",
  storageBucket: "deckedoutwnc.firebasestorage.app",
  messagingSenderId: "910618813751",
  appId: "1:910618813751:web:38dbb49512a530ec6ce6b2",
  measurementId: "G-GPT2BHR1W0",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Connect to local emulators when running on localhost
if (
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
