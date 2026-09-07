import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin.js";

export async function requireStaff(uid) {
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const snap = await db.collection("users").doc(uid).get();
  if (snap.data()?.role !== "staff") {
    throw new HttpsError("permission-denied", "Staff access required.");
  }
}
