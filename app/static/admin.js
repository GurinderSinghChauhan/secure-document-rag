let accessToken = null;
let currentUser = null;

const adminLoading = document.querySelector("#admin-loading");
const adminShell = document.querySelector("#admin-shell");
const adminUserName = document.querySelector("#admin-user-name");
const adminOrgName = document.querySelector("#admin-org-name");
const logoutButton = document.querySelector("#admin-logout");
const uploadForm = document.querySelector("#upload-form");
const documentFile = document.querySelector("#document-file");
const fileDropzone = document.querySelector("#file-dropzone");
const fileLabel = document.querySelector("#file-label");
const allowedRoles = document.querySelector("#allowed-roles");
const allowedUsers = document.querySelector("#allowed-users");
const uploadButton = document.querySelector("#upload-button");
const uploadStatus = document.querySelector("#upload-status");
const uploadProgress = document.querySelector("#upload-progress");
const uploadProgressTrack = document.querySelector("#upload-progress-track");
const uploadProgressFill = document.querySelector("#upload-progress-fill");
const uploadProgressValue = document.querySelector("#upload-progress-value");
const indexingProgressRow = document.querySelector("#indexing-progress-row");
const indexingProgressTrack = document.querySelector("#indexing-progress-track");
const indexingProgressFill = document.querySelector("#indexing-progress-fill");
const indexingProgressValue = document.querySelector("#indexing-progress-value");
const heldJobs = document.querySelector("#held-jobs");
const refreshJobsButton = document.querySelector("#refresh-jobs");
const releaseJobsButton = document.querySelector("#release-jobs");
const computeMessage = document.querySelector("#compute-message");
const maxJobs = document.querySelector("#max-jobs");
const maxGpuMinutes = document.querySelector("#max-gpu-minutes");
const maxCost = document.querySelector("#max-cost");
const inviteForm = document.querySelector("#invite-form");
const memberList = document.querySelector("#member-list");
const memberMessage = document.querySelector("#member-message");
const inviteLinkPanel = document.querySelector("#invite-link-panel");
const inviteLink = document.querySelector("#invite-link");
const copyInviteLink = document.querySelector("#copy-invite-link");
const refreshMembers = document.querySelector("#refresh-members");
const platformConsoleLink = document.querySelector("#platform-console-link");
const trialStatus = document.querySelector("#trial-status");

function requestHeaders() {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function responseError(payload, fallback) {
  const detail = Array.isArray(payload.detail) ? payload.detail[0]?.msg : payload.detail;
  return typeof detail === "string" ? detail : fallback;
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

async function authJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(responseError(payload, "Authentication request failed."));
  return payload;
}

function setUploadStatus(message, state = "") {
  uploadStatus.className = `upload-status ${state}`.trim();
  uploadStatus.lastChild.textContent = ` ${message}`;
}

function setUploadProgress(value, state = "") {
  const percentage = Math.max(0, Math.min(100, Math.round(value)));
  uploadProgress.hidden = false;
  uploadProgress.className = `upload-progress ${state}`.trim();
  uploadProgressTrack.setAttribute("aria-valuenow", String(percentage));
  uploadProgressFill.style.width = `${percentage}%`;
  uploadProgressValue.textContent = `${percentage}%`;
}

function setIndexingProgress(value) {
  const percentage = Math.max(0, Math.min(100, Math.round(value)));
  uploadProgress.hidden = false;
  indexingProgressRow.hidden = false;
  indexingProgressTrack.setAttribute("aria-valuenow", String(percentage));
  indexingProgressFill.style.width = `${percentage}%`;
  indexingProgressValue.textContent = `${percentage}%`;
}

function resetUploadProgress() {
  uploadProgress.hidden = true;
  uploadProgress.className = "upload-progress";
  uploadProgressTrack.setAttribute("aria-valuenow", "0");
  uploadProgressFill.style.width = "0%";
  uploadProgressValue.textContent = "0%";
  indexingProgressRow.hidden = true;
  indexingProgressRow.classList.remove("error");
  indexingProgressTrack.setAttribute("aria-valuenow", "0");
  indexingProgressFill.style.width = "0%";
  indexingProgressValue.textContent = "0%";
}

function uploadDocument(file, headers, batchLabel = "") {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let responseOffset = 0;
    let responseBuffer = "";
    let completedPayload;
    let streamError;

    function processResponse(isComplete = false) {
      responseBuffer += request.responseText.slice(responseOffset);
      responseOffset = request.responseText.length;
      const lines = responseBuffer.split("\n");
      responseBuffer = isComplete ? "" : lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line);
        if (payload.type === "error") streamError = new Error(payload.detail || "Unable to save the document.");
        if (payload.type === "complete") completedPayload = payload;
        if (payload.type === "progress") {
          setIndexingProgress(payload.percentage);
          setUploadStatus(payload.message ? `${batchLabel}${payload.message}` : `${batchLabel}Saving ${file.name}…`, "busy");
        }
      }
    }

    request.open("POST", "/v1/documents/stream");
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setUploadProgress((event.loaded / event.total) * 100);
      setUploadStatus(`${batchLabel}Uploading ${file.name}…`, "busy");
    });
    request.upload.addEventListener("load", () => {
      setUploadProgress(100, "success");
      setIndexingProgress(0);
      setUploadStatus(`${batchLabel}Upload complete. Saving ${file.name} for compute…`, "busy");
    });
    request.addEventListener("progress", () => processResponse());
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        let payload = {};
        try { payload = JSON.parse(request.responseText); } catch { payload = {}; }
        resolve({ ok: false, payload });
        return;
      }
      processResponse(true);
      if (streamError) return reject(streamError);
      if (!completedPayload) return reject(new Error("The upload service returned an incomplete response."));
      resolve({ ok: true, payload: completedPayload });
    });
    request.addEventListener("error", () => reject(new Error("Unable to connect to the RAG service.")));
    request.addEventListener("abort", () => reject(new Error("Document upload was cancelled.")));
    request.send(file);
  });
}

function updateSelectedFile() {
  const files = Array.from(documentFile.files);
  if (files.length === 0) fileLabel.textContent = "Choose documents";
  else if (files.length === 1) fileLabel.textContent = files[0].name;
  else fileLabel.textContent = `${files.length} documents selected`;
  setUploadStatus(files.length ? `${files.length} ${files.length === 1 ? "document is" : "documents are"} ready to upload.` : "Select one or more files to begin.");
  uploadButton.querySelector("span").textContent = files.length > 1 ? `Upload and hold ${files.length}` : "Upload and hold";
  resetUploadProgress();
}

documentFile.addEventListener("change", updateSelectedFile);
["dragenter", "dragover"].forEach((eventName) => fileDropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  fileDropzone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((eventName) => fileDropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  fileDropzone.classList.remove("dragging");
}));
fileDropzone.addEventListener("drop", (event) => {
  if (!event.dataTransfer.files.length) return;
  documentFile.files = event.dataTransfer.files;
  updateSelectedFile();
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = Array.from(documentFile.files);
  if (!files.length) return setUploadStatus("Select one or more documents first.", "error");
  uploadButton.disabled = true;
  setUploadStatus(`Preparing ${files.length} ${files.length === 1 ? "document" : "documents"}…`, "busy");
  const queued = [];
  const failed = [];
  try {
    for (const [index, file] of files.entries()) {
      resetUploadProgress();
      setUploadProgress(0);
      const batchLabel = files.length > 1 ? `Document ${index + 1} of ${files.length}: ` : "";
      const headers = { ...requestHeaders(), "X-Document-Name": file.name, "Content-Type": file.type || "text/plain" };
      if (allowedRoles.value.trim()) headers["X-Allowed-Roles"] = allowedRoles.value.trim();
      if (allowedUsers.value.trim()) headers["X-Allowed-Users"] = allowedUsers.value.trim();
      try {
        const { ok, payload } = await uploadDocument(file, headers, batchLabel);
        if (!ok) throw new Error(responseError(payload, "Unable to save the document."));
        queued.push(file.name);
        setUploadProgress(100, "success");
      } catch (error) {
        failed.push({ name: file.name, message: error.message });
        if (uploadProgressTrack.getAttribute("aria-valuenow") === "100") indexingProgressRow.classList.add("error");
        else uploadProgress.classList.add("error");
      }
    }
    if (failed.length) setUploadStatus(`${queued.length} of ${files.length} saved. Failed: ${failed.map(({ name }) => name).join(", ")}.`, "error");
    else {
      setUploadStatus(`${queued.length} ${queued.length === 1 ? "document is" : "documents are"} saved and waiting for release.`, "success");
      documentFile.value = "";
      fileLabel.textContent = "Choose more documents";
      uploadButton.querySelector("span").textContent = "Upload and hold";
      await loadHeldJobs();
    }
  } finally {
    uploadButton.disabled = false;
  }
});

async function loadHeldJobs() {
  const response = await fetch("/v1/admin/ingestion-jobs?state=held_for_compute", { headers: requestHeaders() });
  const payload = await response.json();
  if (!response.ok) {
    computeMessage.textContent = responseError(payload, "Unable to load held documents.");
    return;
  }
  heldJobs.innerHTML = payload.length
    ? payload.map((job) => `<label class="held-job"><input type="checkbox" value="${job.job_id}"><span><strong>${escapeHtml(job.document_name)}</strong><small>${escapeHtml(job.message)}</small></span></label>`).join("")
    : "<small>No documents are waiting for compute.</small>";
  computeMessage.textContent = payload.length ? `${payload.length} document${payload.length === 1 ? "" : "s"} safely held. Select a bounded batch to process.` : "Nothing is waiting for compute.";
}

function renderSessionJobs(payload) {
  heldJobs.innerHTML = payload.jobs.map((job) => `<div class="held-job"><span><strong>${escapeHtml(job.document_name)}</strong><small>${escapeHtml(job.stage.replaceAll("_", " "))} · ${job.progress}% — ${escapeHtml(job.message)}</small><span class="job-progress"><i style="width:${job.progress}%"></i></span></span></div>`).join("");
  const minutes = (payload.gpu_seconds / 60).toFixed(1);
  computeMessage.textContent = payload.status === "closed"
    ? `Session closed. GPU capacity released after ${minutes} recorded GPU minutes. Estimated cost: $${payload.estimated_cost_usd.toFixed(4)}.`
    : `Session ${payload.status}: ${minutes} of ${payload.max_gpu_minutes} GPU minutes used.`;
}

async function pollComputeSession(sessionId) {
  for (;;) {
    const response = await fetch(`/v1/admin/compute-sessions/${sessionId}`, { headers: requestHeaders() });
    if (!response.ok) return;
    const payload = await response.json();
    renderSessionJobs(payload);
    if (payload.status === "closed") {
      window.setTimeout(loadHeldJobs, 1500);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
}

refreshJobsButton.addEventListener("click", loadHeldJobs);
releaseJobsButton.addEventListener("click", async () => {
  const selected = Array.from(heldJobs.querySelectorAll("input:checked"), (input) => input.value);
  if (!selected.length) {
    computeMessage.textContent = "Select at least one held document.";
    return;
  }
  releaseJobsButton.disabled = true;
  try {
    const limits = { max_jobs: Number(maxJobs.value), max_gpu_minutes: Number(maxGpuMinutes.value) };
    if (maxCost.value) limits.max_estimated_cost_usd = Number(maxCost.value);
    const opened = await fetch("/v1/admin/compute-sessions", { method: "POST", headers: { ...requestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(limits) });
    const session = await opened.json();
    if (!opened.ok) throw new Error(responseError(session, "Unable to open compute session."));
    const released = await fetch(`/v1/admin/compute-sessions/${session.session_id}/release`, { method: "POST", headers: { ...requestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ job_ids: selected }) });
    const payload = await released.json();
    if (!released.ok) throw new Error(responseError(payload, "Unable to release jobs."));
    renderSessionJobs(payload);
    pollComputeSession(session.session_id);
  } catch (error) {
    computeMessage.textContent = error.message;
  } finally {
    releaseJobsButton.disabled = false;
  }
});

async function loadMembers() {
  const response = await fetch("/v1/admin/organization/members", { headers: requestHeaders() });
  if (!response.ok) {
    memberMessage.textContent = responseError(await response.json(), "Unable to load members.");
    return;
  }
  const members = await response.json();
  memberList.innerHTML = members.map((member) => `<div class="held-job"><span><strong>${escapeHtml(member.display_name)}</strong><small>${escapeHtml(member.email)} · ${member.role}${member.active ? "" : " · inactive"}</small>${member.active ? `<span><button class="text-button" data-member-action="role" data-user-id="${member.user_id}" data-role="${member.role}">Make ${member.role === "admin" ? "member" : "admin"}</button><button class="text-button" data-member-action="revoke" data-user-id="${member.user_id}">Revoke sessions</button><button class="text-button" data-member-action="deactivate" data-user-id="${member.user_id}">Deactivate</button></span>` : ""}</span></div>`).join("");
}

refreshMembers.addEventListener("click", loadMembers);
inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const response = await fetch("/v1/admin/organization/invitations", { method: "POST", headers: { ...requestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ email: document.querySelector("#invite-email").value, role: document.querySelector("#invite-role").value }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(responseError(payload, "Unable to create invitation."));
    memberMessage.textContent = payload.message;
    inviteLinkPanel.hidden = !payload.invitation_url;
    inviteLink.value = payload.invitation_url || "";
    inviteForm.reset();
  } catch (error) {
    memberMessage.textContent = error.message;
  }
});

copyInviteLink.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    memberMessage.textContent = "Invitation link copied. It expires in 72 hours.";
  } catch {
    inviteLink.select();
    memberMessage.textContent = "Copy the selected invitation link.";
  }
});

memberList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-member-action]");
  if (!button) return;
  const action = button.dataset.memberAction;
  const userId = button.dataset.userId;
  const path = `/v1/admin/organization/members/${userId}/${action === "role" ? "role" : action === "revoke" ? "revoke-sessions" : "deactivate"}`;
  const options = { method: action === "role" ? "PATCH" : "POST", headers: { ...requestHeaders(), "Content-Type": "application/json" } };
  if (action === "role") options.body = JSON.stringify({ role: button.dataset.role === "admin" ? "member" : "admin" });
  const response = await fetch(path, options);
  const payload = await response.json();
  memberMessage.textContent = response.ok ? "Member updated." : responseError(payload, "Unable to update member.");
  await loadMembers();
});

logoutButton.addEventListener("click", async () => {
  try { await authJson("/v1/auth/logout", { method: "POST" }); } catch {}
  location.replace("/");
});

async function bootstrapAdmin() {
  try {
    const payload = await authJson("/v1/auth/refresh", { method: "POST", body: "{}" });
    if (payload.user?.role !== "admin") {
      location.replace("/");
      return;
    }
    accessToken = payload.access_token;
    currentUser = payload.user;
    adminUserName.textContent = currentUser.display_name;
    adminOrgName.textContent = `${currentUser.organization.name} · Admin`;
    platformConsoleLink.hidden = !currentUser.is_super_admin;
    if (currentUser.is_super_admin) {
      trialStatus.textContent = "Platform access · trial limits do not apply";
    } else {
      const ends = new Date(currentUser.trial.ends_at);
      trialStatus.textContent = currentUser.trial.active
        ? `Free trial · 2 PDFs per UTC day · ends ${ends.toLocaleString()}`
        : "Free trial ended · querying and document processing are unavailable";
      if (!currentUser.trial.active) {
        uploadButton.disabled = true;
        releaseJobsButton.disabled = true;
      }
    }
    adminLoading.hidden = true;
    adminShell.hidden = false;
    await Promise.all([loadHeldJobs(), loadMembers()]);
  } catch {
    location.replace("/");
  }
}

bootstrapAdmin();
