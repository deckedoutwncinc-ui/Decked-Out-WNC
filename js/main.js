import { onAuthChange, signIn, signOutUser, getUserRole } from "./auth.js";
import { createLead, updateJobStage, listJobs } from "./jobs.js";
import { STAGES, canTransition } from "./pipeline.js";
import { uploadReceipt, listReceipts } from "./receipts.js";
import { postActivity, listActivity } from "./activity.js";

function formatDateMDY(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

function isSafeStorageUrl(url) {
  if (typeof url !== "string") return false;
  return (
    url.startsWith("https://firebasestorage.googleapis.com/v0/b/deckedoutwnc.firebasestorage.app/") ||
    url.startsWith("http://127.0.0.1:9199/v0/b/deckedoutwnc.firebasestorage.app/") ||
    url.startsWith("http://localhost:9199/v0/b/deckedoutwnc.firebasestorage.app/")
  );
}

function formatEntryTimestamp(createdAt) {
  if (!createdAt || typeof createdAt.toDate !== "function") return "";
  const iso = createdAt.toDate().toISOString().slice(0, 10);
  return formatDateMDY(iso);
}

const OPEN_STAGES = new Set(["LEAD_IN", "BID_SCHEDULED", "DESIGN_FEE", "BID_GIVEN"]);

function stageBadgeClass(status) {
  if (status === "LOST") return "stage-lost";
  if (OPEN_STAGES.has(status)) return "";
  return "stage-won";
}

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const signoutBtn = document.getElementById("signout-btn");
const newLeadForm = document.getElementById("new-lead-form");
const newLeadSection = document.getElementById("new-lead-section");
const jobList = document.getElementById("job-list");
const appError = document.getElementById("app-error");
const pipelineSection = document.getElementById("pipeline-section");
const jobDetailSection = document.getElementById("job-detail-section");
const jobDetailTitle = document.getElementById("job-detail-title");
const jobDetailStatus = document.getElementById("job-detail-status");
const backToListBtn = document.getElementById("back-to-list-btn");
const receiptsSection = document.getElementById("receipts-section");
const receiptsStaffOnlyNotice = document.getElementById("receipts-staff-only-notice");
const receiptsTotal = document.getElementById("receipts-total");
const receiptsList = document.getElementById("receipts-list");
const addReceiptForm = document.getElementById("add-receipt-form");
const receiptPhotoBtn = document.getElementById("receipt-photo-btn");
const receiptFileInput = document.getElementById("receipt-file");
const receiptFileStatus = document.getElementById("receipt-file-status");
const activityList = document.getElementById("activity-list");
const addActivityForm = document.getElementById("add-activity-form");
const activityTextInput = document.getElementById("activity-text");
const activityPhotoBtn = document.getElementById("activity-photo-btn");
const activityFileInput = document.getElementById("activity-file");
const activityFileStatus = document.getElementById("activity-file-status");

let unsubscribeJobs = null;
let currentRole = null;
let unsubscribeReceipts = null;
let unsubscribeActivity = null;
let currentJobId = null;

onAuthChange(async (user) => {
  if (unsubscribeJobs) {
    unsubscribeJobs();
    unsubscribeJobs = null;
  }
  if (!user) {
    currentRole = null;
    closeJobDetail();
    loginView.style.display = "block";
    appView.style.display = "none";
    return;
  }
  try {
    currentRole = await getUserRole(user.uid);
    loginView.style.display = "none";
    appView.style.display = "block";
    newLeadSection.style.display = currentRole === "staff" ? "block" : "none";
    unsubscribeJobs = listJobs(renderJobs);
  } catch (err) {
    loginError.textContent = "There was a problem loading your account. Please try signing in again.";
    await signOutUser();
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  try {
    await signIn(email, password);
  } catch (err) {
    loginError.textContent = "Sign in failed: " + err.message;
  }
});

signoutBtn.addEventListener("click", () => signOutUser());

newLeadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  appError.textContent = "";
  const customerName = document.getElementById("lead-customer-name").value;
  const address = document.getElementById("lead-address").value;
  try {
    await createLead({ customerName, address });
    newLeadForm.reset();
  } catch (err) {
    appError.textContent = "Could not add lead: " + err.message;
  }
});

backToListBtn.addEventListener("click", closeJobDetail);

receiptPhotoBtn.addEventListener("click", () => receiptFileInput.click());

receiptFileInput.addEventListener("change", () => {
  const file = receiptFileInput.files[0];
  if (file) {
    receiptFileStatus.textContent = "Selected: " + file.name;
    receiptFileStatus.classList.add("has-file");
  } else {
    receiptFileStatus.textContent = "No photo selected yet";
    receiptFileStatus.classList.remove("has-file");
  }
});

activityPhotoBtn.addEventListener("click", () => activityFileInput.click());

activityFileInput.addEventListener("change", () => {
  const file = activityFileInput.files[0];
  if (file) {
    activityFileStatus.textContent = "Selected: " + file.name;
    activityFileStatus.classList.add("has-file");
  } else {
    activityFileStatus.textContent = "No photo selected yet";
    activityFileStatus.classList.remove("has-file");
  }
});

addReceiptForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  appError.textContent = "";
  const amount = document.getElementById("receipt-amount").value;
  const vendor = document.getElementById("receipt-vendor").value;
  const date = document.getElementById("receipt-date").value;
  const file = receiptFileInput.files[0];
  if (!file) {
    appError.textContent = "Add a receipt photo before saving.";
    return;
  }
  try {
    await uploadReceipt(currentJobId, { amount, vendor, date, file });
    addReceiptForm.reset();
    receiptFileStatus.textContent = "No photo selected yet";
    receiptFileStatus.classList.remove("has-file");
  } catch (err) {
    appError.textContent = "Could not add receipt: " + err.message;
  }
});

addActivityForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  appError.textContent = "";
  const text = activityTextInput.value.trim();
  const file = activityFileInput.files[0];
  if (!text && !file) {
    appError.textContent = "Add a note or a photo before posting.";
    return;
  }
  try {
    await postActivity(currentJobId, { text: text || null, file: file || null });
    addActivityForm.reset();
    activityFileStatus.textContent = "No photo selected yet";
    activityFileStatus.classList.remove("has-file");
  } catch (err) {
    appError.textContent = "Could not post update: " + err.message;
  }
});

function renderJobs(jobs) {
  jobList.innerHTML = "";
  for (const job of jobs) {
    const card = document.createElement("div");
    card.className = "job-card";

    const title = document.createElement("h3");
    title.textContent = job.customerName ?? "(no name)";
    card.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "stage-badge " + stageBadgeClass(job.status);
    badge.textContent = job.status;
    card.appendChild(badge);

    if (currentRole === "staff") {
      const nextStages = STAGES.filter((s) => canTransition(job.status, s));
      if (nextStages.length > 0) {
        const select = document.createElement("select");
        select.className = "stage-select";
        const placeholder = document.createElement("option");
        placeholder.textContent = "Advance to...";
        placeholder.value = "";
        select.appendChild(placeholder);
        for (const stage of nextStages) {
          const opt = document.createElement("option");
          opt.value = stage;
          opt.textContent = stage;
          select.appendChild(opt);
        }
        select.addEventListener("change", async () => {
          if (!select.value) return;
          appError.textContent = "";
          try {
            await updateJobStage(job.id, job.status, select.value);
          } catch (err) {
            appError.textContent = "Could not update stage: " + err.message;
            select.value = "";
          }
        });
        card.appendChild(select);
      }
    }

    const detailBtn = document.createElement("button");
    detailBtn.className = "btn-quiet";
    detailBtn.textContent = "View Details";
    detailBtn.addEventListener("click", () => openJobDetail(job));
    card.appendChild(detailBtn);

    jobList.appendChild(card);
  }
}

function openJobDetail(job) {
  currentJobId = job.id;
  pipelineSection.hidden = true;
  jobDetailSection.hidden = false;
  jobDetailTitle.textContent = job.customerName ?? "(no name)";
  jobDetailStatus.textContent = job.status;
  jobDetailStatus.className = "stage-badge " + stageBadgeClass(job.status);
  receiptsList.innerHTML = "";
  receiptsTotal.textContent = "";

  if (currentRole === "staff") {
    receiptsSection.hidden = false;
    receiptsStaffOnlyNotice.hidden = true;
    if (unsubscribeReceipts) unsubscribeReceipts();
    unsubscribeReceipts = listReceipts(currentJobId, renderReceipts);
  } else {
    receiptsSection.hidden = true;
    receiptsStaffOnlyNotice.hidden = false;
  }

  if (unsubscribeActivity) unsubscribeActivity();
  activityList.innerHTML = "";
  unsubscribeActivity = listActivity(currentJobId, renderActivity);
}

function closeJobDetail() {
  if (unsubscribeReceipts) {
    unsubscribeReceipts();
    unsubscribeReceipts = null;
  }
  if (unsubscribeActivity) {
    unsubscribeActivity();
    unsubscribeActivity = null;
  }
  currentJobId = null;
  jobDetailSection.hidden = true;
  pipelineSection.hidden = false;
}

function renderReceipts(receipts) {
  receiptsList.innerHTML = "";
  let total = 0;
  for (const receipt of receipts) {
    total += receipt.amount ?? 0;
    const row = document.createElement("div");
    row.className = "receipt-row";
    row.textContent = `${receipt.date ? formatDateMDY(receipt.date) : "—"} — ${receipt.vendor} — $${(receipt.amount ?? 0).toFixed(2)}`;
    if (isSafeStorageUrl(receipt.fileUrl)) {
      const link = document.createElement("a");
      link.href = receipt.fileUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = " (view)";
      row.appendChild(link);
    }
    receiptsList.appendChild(row);
  }
  receiptsTotal.textContent = `Total: $${total.toFixed(2)}`;
}

function renderActivity(entries) {
  activityList.innerHTML = "";
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "activity-entry";

    if (isSafeStorageUrl(entry.photoUrl)) {
      const img = document.createElement("img");
      img.src = entry.photoUrl;
      img.alt = "Job photo";
      row.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "activity-body";
    if (entry.text) {
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent = entry.text;
      body.appendChild(p);
    }
    const meta = document.createElement("p");
    meta.className = "activity-meta";
    const dateStr = formatEntryTimestamp(entry.createdAt);
    meta.textContent = (entry.authorEmail ?? "Unknown") + (dateStr ? " — " + dateStr : "");
    body.appendChild(meta);
    row.appendChild(body);

    activityList.appendChild(row);
  }
}
