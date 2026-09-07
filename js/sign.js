const FUNCTIONS_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://127.0.0.1:5001/deckedoutwnc/us-central1"
  : "https://us-central1-deckedoutwnc.cloudfunctions.net";

const token = new URLSearchParams(location.search).get("token");

const loadingState = document.getElementById("loading-state");
const invalidState = document.getElementById("invalid-state");
const signedState = document.getElementById("signed-state");
const unsignedState = document.getElementById("unsigned-state");
const thankYouState = document.getElementById("thank-you-state");
const contractTextEl = document.getElementById("contract-text");
const signedSummaryEl = document.getElementById("signed-summary");
const downloadLinkEl = document.getElementById("download-link");
const signerNameInput = document.getElementById("signer-name");
const errorEl = document.getElementById("error");
const submitBtn = document.getElementById("submit-signature-btn");
const clearBtn = document.getElementById("clear-signature-btn");

function showState(el) {
  for (const s of [loadingState, invalidState, signedState, unsignedState, thankYouState]) {
    s.hidden = s !== el;
  }
}

let signaturePad;

async function init() {
  if (!token) {
    showState(invalidState);
    return;
  }
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/getContractByToken?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      showState(invalidState);
      return;
    }
    const data = await res.json();
    if (data.status === "SIGNED") {
      signedSummaryEl.textContent = `Signed on ${new Date(data.signedAt).toLocaleDateString("en-US")}.`;
      downloadLinkEl.href = data.pdfUrl;
      showState(signedState);
      return;
    }
    contractTextEl.textContent = data.contractText;
    showState(unsignedState);
    signaturePad = new SignaturePad(document.getElementById("signature-pad-canvas"));
  } catch (err) {
    showState(invalidState);
  }
}

clearBtn.addEventListener("click", () => signaturePad?.clear());

submitBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  const signerName = signerNameInput.value.trim();
  if (!signerName) {
    errorEl.textContent = "Please type your full name.";
    return;
  }
  if (!signaturePad || signaturePad.isEmpty()) {
    errorEl.textContent = "Please sign above before submitting.";
    return;
  }
  submitBtn.disabled = true;
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/submitSignature`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        signerName,
        signatureDataUrl: signaturePad.toDataURL("image/png"),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Something went wrong. Please try again.");
    }
    showState(thankYouState);
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

init();
