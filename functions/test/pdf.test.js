import { test } from "node:test";
import assert from "node:assert/strict";
import { generateContractPdf } from "../lib/pdf.js";

// A well-known minimal valid 1x1 transparent PNG, used purely as fake signature-image bytes.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("generateContractPdf produces a valid PDF buffer", async () => {
  const buffer = await generateContractPdf({
    contractText: "Test contract text.",
    signatureImageBuffer: TINY_PNG,
    signerName: "Jane Doe",
    signedAt: "09/07/2026",
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
});
