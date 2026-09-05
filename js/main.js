import { onAuthChange, signIn, signOutUser, getUserRole } from "./auth.js";
import { createLead, updateJobStage, listJobs } from "./jobs.js";
import { STAGES, canTransition } from "./pipeline.js";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const signoutBtn = document.getElementById("signout-btn");
const newLeadForm = document.getElementById("new-lead-form");
const newLeadSection = document.getElementById("new-lead-section");
const jobList = document.getElementById("job-list");

let unsubscribeJobs = null;
let currentRole = null;

onAuthChange(async (user) => {
  if (unsubscribeJobs) {
    unsubscribeJobs();
    unsubscribeJobs = null;
  }
  if (!user) {
    currentRole = null;
    loginView.style.display = "block";
    appView.style.display = "none";
    return;
  }
  currentRole = await getUserRole(user.uid);
  loginView.style.display = "none";
  appView.style.display = "block";
  newLeadSection.style.display = currentRole === "staff" ? "block" : "none";
  unsubscribeJobs = listJobs(renderJobs);
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
  const customerName = document.getElementById("lead-customer-name").value;
  const address = document.getElementById("lead-address").value;
  await createLead({ customerName, address });
  newLeadForm.reset();
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
          await updateJobStage(job.id, job.status, select.value);
        });
        card.appendChild(select);
      }
    }

    jobList.appendChild(card);
  }
}
