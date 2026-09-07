import { test } from "node:test";
import assert from "node:assert/strict";
import { db, bucket } from "../lib/admin.js";

test("Admin SDK can write and read a document against the Firestore emulator", async () => {
  await db.collection("_scaffold_check").doc("ping").set({ ok: true });
  const snap = await db.collection("_scaffold_check").doc("ping").get();
  assert.equal(snap.data().ok, true);
});

test("Admin SDK can write and read a file against the Storage emulator", async () => {
  const file = bucket.file("_scaffold_check/ping.txt");
  await file.save(Buffer.from("ok"), { contentType: "text/plain" });
  const [contents] = await file.download();
  assert.equal(contents.toString(), "ok");
});
