import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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
