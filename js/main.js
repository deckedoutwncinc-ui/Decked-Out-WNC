import { onAuthChange, signIn, signOutUser, getUserRole } from "./auth.js";
import { createLead, updateJobStage, listJobs } from "./jobs.js";
import { STAGES, canTransition } from "./pipeline.js";
import { uploadReceipt, listReceipts } from "./receipts.js";

function formatDateMDY(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
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

let unsubscribeJobs = null;
let currentRole = null;
let unsubscribeReceipts = null;
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

addReceiptForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  appError.textContent = "";
  const amount = document.getElementById("receipt-amount").value;
  const vendor = document.getElementById("receipt-vendor").value;
  const date = document.getElementById("receipt-date").value;
  const file = document.getElementById("receipt-file").files[0];
  try {
    await uploadReceipt(currentJobId, { amount, vendor, date, file });
    addReceiptForm.reset();
  } catch (err) {
    appError.textContent = "Could not add receipt: " + err.message;
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
    badge.className = "stage-badge";
    badge.textContent = job.status;
    card.appendChild(badge);

    if (currentRole === "staff") {
      const nextStages = STAGES.filter((s) => canTransition(job.status, s));
      if (nextStages.length > 0) {
        const select = document.createElement("select");
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
}

function closeJobDetail() {
  if (unsubscribeReceipts) {
    unsubscribeReceipts();
    unsubscribeReceipts = null;
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
    if (typeof receipt.fileUrl === "string" && receipt.fileUrl.startsWith("https://")) {
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
