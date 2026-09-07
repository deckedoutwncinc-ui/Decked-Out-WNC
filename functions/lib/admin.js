import admin from "firebase-admin";

const projectId = process.env.GCLOUD_PROJECT || "deckedoutwnc";

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId,
    storageBucket: `${projectId}.firebasestorage.app`,
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
