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

test("generateContractPdf paginates a long contract across multiple pages", async () => {
  const longText = Array(80).fill("This is a line of contract text that repeats to force pagination.").join("\n");
  const buffer = await generateContractPdf({
    contractText: longText,
    signatureImageBuffer: TINY_PNG,
    signerName: "Jane Doe",
    signedAt: "09/07/2026",
  });
  const { PDFDocument } = await import("pdf-lib");
  const reloaded = await PDFDocument.load(buffer);
  assert.ok(reloaded.getPageCount() >= 2);
});

test("generateContractPdf sanitizes tabs, non-WinAnsi symbols, and non-Latin-1 names instead of throwing", async () => {
  const buffer = await generateContractPdf({
    contractText: "Scope of work:\tBuild deck ✓\r\nInstall railing ✓",
    signatureImageBuffer: TINY_PNG,
    signerName: "Nguyễn Văn A",
    signedAt: "09/07/2026",
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");

  const { PDFDocument } = await import("pdf-lib");
  const reloaded = await PDFDocument.load(buffer);
  assert.ok(reloaded.getPageCount() >= 1);
});
