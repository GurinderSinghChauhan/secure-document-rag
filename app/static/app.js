const form = document.querySelector("#chat-form");
const question = document.querySelector("#question");
let accessToken = null;
let currentUser = null;
const chatLog = document.querySelector("#chat-log");
const sendButton = document.querySelector("#send-button");
const status = document.querySelector("#status");
const settingsToggle = document.querySelector("#settings-toggle");
const settingsPanel = document.querySelector("#settings-panel");
const settingsClose = document.querySelector("#settings-close");
const settingsDone = document.querySelector("#settings-done");
const tenantChip = document.querySelector("#tenant-chip");
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
const chatHistoryList = document.querySelector("#chat-history-list");
const chatHistoryEmpty = document.querySelector("#chat-history-empty");
const newChatButton = document.querySelector("#new-chat-button");
const heldJobs = document.querySelector("#held-jobs");
const refreshJobsButton = document.querySelector("#refresh-jobs");
const releaseJobsButton = document.querySelector("#release-jobs");
const computeMessage = document.querySelector("#compute-message");
const maxJobs = document.querySelector("#max-jobs");
const maxGpuMinutes = document.querySelector("#max-gpu-minutes");
const maxCost = document.querySelector("#max-cost");
const authGate = document.querySelector("#auth-gate");
const authMessage = document.querySelector("#auth-message");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const authModeToggle = document.querySelector("#auth-mode-toggle");
const accountActionForm = document.querySelector("#account-action-form");
const actionNameField = document.querySelector("#action-name-field");
let pendingAccountAction = null;
const logoutButton = document.querySelector("#logout-button");
const accountSummary = document.querySelector("#account-summary");
const inviteForm = document.querySelector("#invite-form");
const memberList = document.querySelector("#member-list");
const memberMessage = document.querySelector("#member-message");
const inviteLinkPanel = document.querySelector("#invite-link-panel");
const inviteLink = document.querySelector("#invite-link");
const copyInviteLink = document.querySelector("#copy-invite-link");
const refreshMembers = document.querySelector("#refresh-members");
const emptyChatMarkup = chatLog.innerHTML;
let activeChatId = null;

function updateTenantChip() {
  tenantChip.textContent = currentUser?.organization?.name || "Signed out";
}

function setSettingsOpen(isOpen) {
  settingsPanel.hidden = !isOpen;
  settingsToggle.setAttribute("aria-expanded", String(isOpen));
}

function saveConnectionSettings() {}

settingsToggle.addEventListener("click", () => setSettingsOpen(settingsPanel.hidden));
settingsClose.addEventListener("click", () => setSettingsOpen(false));
settingsDone.addEventListener("click", () => {
  setSettingsOpen(false);
  activeChatId = null;
  resetConversation();
  loadChatHistory();
  settingsToggle.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsPanel.hidden) {
    setSettingsOpen(false);
    settingsToggle.focus();
  }
});

document.addEventListener("click", (event) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(event.target) && !settingsToggle.contains(event.target)) {
    setSettingsOpen(false);
  }
});

function messageTime() {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date());
}

function addMessage(text, type) {
  chatLog.querySelector(".empty-state")?.remove();

  const message = document.createElement("article");
  message.className = `message ${type}-message`;

  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = type === "user" ? "You" : type === "error" ? "!" : "AI";

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("p");
  meta.className = "message-meta";
  const author = document.createElement("strong");
  author.textContent = type === "user" ? "You" : type === "error" ? "Request failed" : "Document assistant";
  const time = document.createElement("span");
  time.textContent = messageTime();
  meta.append(author, time);

  const content = document.createElement("div");
  content.className = "message-content";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  content.append(paragraph);
  body.append(meta, content);

  if (type === "user") message.append(body, avatar);
  else message.append(avatar, body);

  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
  return paragraph;
}

function resetConversation() {
  chatLog.innerHTML = emptyChatMarkup;
  activeChatId = null;
  renderActiveChat();
  question.focus();
}

function renderActiveChat() {
  chatHistoryList.querySelectorAll(".chat-history-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.chatId === activeChatId);
  });
}

function formatChatDate(value) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function renderChatHistory(chats) {
  chatHistoryList.replaceChildren();
  chatHistoryEmpty.hidden = chats.length > 0;
  chatHistoryEmpty.textContent = chats.length ? "" : "No saved chats yet.";
  chats.forEach((chat) => {
    const button = document.createElement("button");
    button.className = "chat-history-item";
    button.type = "button";
    button.dataset.chatId = chat.chat_id;
    const title = document.createElement("strong");
    title.textContent = chat.title;
    const time = document.createElement("time");
    time.dateTime = chat.updated_at;
    time.textContent = formatChatDate(chat.updated_at);
    button.append(title, time);
    button.addEventListener("click", () => loadChat(chat.chat_id));
    chatHistoryList.append(button);
  });
  renderActiveChat();
}

async function loadChatHistory() {
  const { tenant: selectedTenant, apiKey: selectedApiKey } = connectionSettings();
  if (!selectedTenant || !selectedApiKey) {
    chatHistoryList.replaceChildren();
    chatHistoryEmpty.hidden = false;
    chatHistoryEmpty.textContent = "Connect to load your chat history.";
    return;
  }
  chatHistoryEmpty.hidden = false;
  chatHistoryEmpty.textContent = "Loading chats…";
  try {
    const response = await fetch("/v1/chats", { headers: requestHeaders(selectedTenant, selectedApiKey) });
    const payload = await response.json();
    if (!response.ok) throw new Error(responseError(payload, "Unable to load chat history."));
    renderChatHistory(payload);
  } catch (error) {
    chatHistoryList.replaceChildren();
    chatHistoryEmpty.hidden = false;
    chatHistoryEmpty.textContent = error.message || "Unable to load chat history.";
  }
}

async function loadChat(chatId) {
  if (sendButton.disabled) return;
  const { tenant: selectedTenant, apiKey: selectedApiKey } = connectionSettings();
  try {
    const response = await fetch(`/v1/chats/${encodeURIComponent(chatId)}`, { headers: requestHeaders(selectedTenant, selectedApiKey) });
    const payload = await response.json();
    if (!response.ok) throw new Error(responseError(payload, "Unable to load this chat."));
    chatLog.replaceChildren();
    payload.messages.forEach((message) => addMessage(message.content, message.role));
    activeChatId = payload.chat_id;
    renderActiveChat();
    chatLog.scrollTop = chatLog.scrollHeight;
  } catch (error) {
    addMessage(error.message || "Unable to load this chat.", "error");
  }
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  question.disabled = isBusy;
  newChatButton.disabled = isBusy;
  chatHistoryList.querySelectorAll("button").forEach((button) => { button.disabled = isBusy; });
  status.classList.toggle("busy", isBusy);
  status.lastChild.textContent = isBusy ? " Searching authorized documents…" : " Ready to search";
}

function requestHeaders(selectedTenant, selectedApiKey) {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function connectionSettings() {
  return {
    tenant: currentUser?.organization?.organization_id || "",
    apiKey: accessToken || "",
  };
}

function showConnectionError() {
  authGate.hidden = false;
  addMessage("Sign in to your organization before continuing.", "error");
}

function responseError(payload, fallback) {
  const detail = Array.isArray(payload.detail) ? payload.detail[0]?.msg : payload.detail;
  return typeof detail === "string" ? detail : fallback;
}

async function submitQuestion() {
  const userQuestion = question.value.trim();
  const { tenant: selectedTenant, apiKey: selectedApiKey } = connectionSettings();

  if (!selectedTenant || !selectedApiKey) {
    showConnectionError();
    return;
  }

  if (userQuestion.length < 3) {
    addMessage("Enter a question with at least three characters.", "error");
    return;
  }

  saveConnectionSettings();
  addMessage(userQuestion, "user");
  question.value = "";
  setBusy(true);

  try {
    const response = await fetch("/v1/query/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...requestHeaders(selectedTenant, selectedApiKey),
      },
      body: JSON.stringify({ question: userQuestion, ...(activeChatId ? { chat_id: activeChatId } : {}) }),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(responseError(payload, "Unable to complete the request."));
    }
    if (!response.body) throw new Error("Streaming is not supported by this browser.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let answerElement;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.detail || "Unable to generate an answer.");
        if (event.type === "chat") {
          activeChatId = event.chat_id;
          continue;
        }
        if (event.type !== "delta" || typeof event.text !== "string") continue;
        if (!answerElement) {
          answerElement = addMessage("", "assistant");
          status.lastChild.textContent = " Generating answer…";
        }
        answer += event.text;
        answerElement.textContent = answer;
        chatLog.scrollTop = chatLog.scrollHeight;
      }

      if (done) break;
    }

    if (!answerElement) throw new Error("The model returned an empty answer.");
    await loadChatHistory();
  } catch (error) {
    addMessage(error.message || "Unable to connect to the RAG service.", "error");
  } finally {
    setBusy(false);
    question.focus();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitQuestion();
});

question.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    form.requestSubmit();
  }
});

chatLog.addEventListener("click", (event) => {
  const button = event.target.closest("[data-prompt]");
  if (button) {
    question.value = button.dataset.prompt;
    question.focus();
  }
});

newChatButton.addEventListener("click", resetConversation);

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
        if (payload.type === "error") streamError = new Error(payload.detail || "Unable to index the document.");
        if (payload.type === "complete") completedPayload = payload;
        if (payload.type === "progress") {
          setIndexingProgress(payload.percentage);
          setUploadStatus(payload.message ? `${batchLabel}${payload.message}` : `${batchLabel}Indexing ${file.name}…`, "busy");
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
        try {
          payload = JSON.parse(request.responseText);
        } catch {
          payload = {};
        }
        resolve({ ok: false, payload });
        return;
      }
      processResponse(true);
      if (streamError) {
        reject(streamError);
        return;
      }
      if (!completedPayload) {
        reject(new Error("The indexing service returned an incomplete response."));
        return;
      }
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
  setUploadStatus(
    files.length ? `${files.length} ${files.length === 1 ? "document is" : "documents are"} ready to upload.` : "Select one or more files to begin.",
  );
  uploadButton.querySelector("span").textContent = files.length > 1 ? `Upload and hold ${files.length}` : "Upload and hold";
  resetUploadProgress();
}

documentFile.addEventListener("change", updateSelectedFile);

["dragenter", "dragover"].forEach((eventName) => {
  fileDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDropzone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  fileDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    fileDropzone.classList.remove("dragging");
  });
});

fileDropzone.addEventListener("drop", (event) => {
  if (!event.dataTransfer.files.length) return;
  documentFile.files = event.dataTransfer.files;
  updateSelectedFile();
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { tenant: selectedTenant, apiKey: selectedApiKey } = connectionSettings();
  const files = Array.from(documentFile.files);

  if (!selectedTenant || !selectedApiKey) {
    showConnectionError();
    return;
  }
  if (!files.length) {
    setUploadStatus("Select one or more documents first.", "error");
    return;
  }

  saveConnectionSettings();
  uploadButton.disabled = true;
  setUploadProgress(0);
  setUploadStatus(`Preparing ${files.length} ${files.length === 1 ? "document" : "documents"}…`, "busy");

  const queued = [];
  const failed = [];
  try {
    for (const [index, file] of files.entries()) {
      resetUploadProgress();
      setUploadProgress(0);
      const batchLabel = files.length > 1 ? `Document ${index + 1} of ${files.length}: ` : "";
      const headers = {
        ...requestHeaders(selectedTenant, selectedApiKey),
        "X-Document-Name": file.name,
        "Content-Type": file.type || "text/plain",
      };
      if (allowedRoles.value.trim()) headers["X-Allowed-Roles"] = allowedRoles.value.trim();
      if (allowedUsers.value.trim()) headers["X-Allowed-Users"] = allowedUsers.value.trim();

      try {
        const { ok, payload } = await uploadDocument(file, headers, batchLabel);
        if (!ok) throw new Error(responseError(payload, "Unable to save the document."));
        queued.push({ file, payload });
        setUploadProgress(100, "success");
        uploadProgress.classList.add("success");
      } catch (error) {
        failed.push({ file, message: error.message || "Unable to index the document." });
        if (uploadProgressTrack.getAttribute("aria-valuenow") === "100") indexingProgressRow.classList.add("error");
        else uploadProgress.classList.add("error");
      }
    }

    if (failed.length) {
      const failedNames = failed.map(({ file }) => file.name).join(", ");
      setUploadStatus(`${queued.length} of ${files.length} saved. Failed: ${failedNames}.`, "error");
    } else {
      setUploadStatus(`${queued.length} ${queued.length === 1 ? "document is" : "documents are"} saved and waiting. GPU processing is off.`, "success");
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
  const { tenant, apiKey: key } = connectionSettings();
  if (!tenant || !key) return;
  const response = await fetch("/v1/admin/ingestion-jobs?state=held_for_compute", { headers: requestHeaders(tenant, key) });
  if (!response.ok) {
    computeMessage.textContent = responseError(await response.json(), "Unable to load held documents.");
    return;
  }
  const jobs = await response.json();
  heldJobs.innerHTML = jobs.length
    ? jobs.map((job) => `<label class="held-job"><input type="checkbox" value="${job.job_id}"><span><strong>${escapeHtml(job.document_name)}</strong><small>${escapeHtml(job.message)}</small></span></label>`).join("")
    : "<small>No documents are waiting for compute.</small>";
  computeMessage.textContent = jobs.length ? `${jobs.length} document${jobs.length === 1 ? "" : "s"} safely held. Select a bounded batch to process.` : "GPU capacity is zero; nothing is waiting.";
}

function renderSessionJobs(sessionPayload) {
  heldJobs.innerHTML = sessionPayload.jobs.map((job) => `<div class="held-job"><span><strong>${escapeHtml(job.document_name)}</strong><small>${escapeHtml(job.stage.replaceAll("_", " "))} · ${job.progress}% — ${escapeHtml(job.message)}</small><span class="job-progress"><i style="width:${job.progress}%"></i></span></span></div>`).join("");
  const minutes = (sessionPayload.gpu_seconds / 60).toFixed(1);
  computeMessage.textContent = sessionPayload.status === "closed"
    ? `Session closed. GPU capacity released after ${minutes} recorded GPU minutes. Estimated cost: $${sessionPayload.estimated_cost_usd.toFixed(4)}.`
    : `Session ${sessionPayload.status}: ${minutes} of ${sessionPayload.max_gpu_minutes} GPU minutes used.`;
}

async function pollComputeSession(sessionId, tenant, key) {
  for (;;) {
    const response = await fetch(`/v1/admin/compute-sessions/${sessionId}`, { headers: requestHeaders(tenant, key) });
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
  const { tenant, apiKey: key } = connectionSettings();
  if (!tenant || !key) return showConnectionError();
  if (!selected.length) {
    computeMessage.textContent = "Select at least one held document.";
    return;
  }
  releaseJobsButton.disabled = true;
  try {
    const limits = { max_jobs: Number(maxJobs.value), max_gpu_minutes: Number(maxGpuMinutes.value) };
    if (maxCost.value) limits.max_estimated_cost_usd = Number(maxCost.value);
    const opened = await fetch("/v1/admin/compute-sessions", { method: "POST", headers: { ...requestHeaders(tenant, key), "Content-Type": "application/json" }, body: JSON.stringify(limits) });
    const sessionPayload = await opened.json();
    if (!opened.ok) throw new Error(responseError(sessionPayload, "Unable to open compute session."));
    const released = await fetch(`/v1/admin/compute-sessions/${sessionPayload.session_id}/release`, { method: "POST", headers: { ...requestHeaders(tenant, key), "Content-Type": "application/json" }, body: JSON.stringify({ job_ids: selected }) });
    const releasePayload = await released.json();
    if (!released.ok) throw new Error(responseError(releasePayload, "Unable to release jobs."));
    computeMessage.textContent = `Batch released with a ${limits.max_gpu_minutes}-minute GPU limit. Capacity will return to zero when it drains.`;
    renderSessionJobs(releasePayload);
    pollComputeSession(sessionPayload.session_id, tenant, key);
  } catch (error) {
    computeMessage.textContent = error.message;
  } finally {
    releaseJobsButton.disabled = false;
  }
});

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function applyAuthenticatedUser(payload) {
  accessToken = payload.access_token;
  currentUser = payload.user;
  authGate.hidden = true;
  updateTenantChip();
  accountSummary.textContent = `${currentUser.display_name} · ${currentUser.role} at ${currentUser.organization.name}`;
  const isAdmin = currentUser.role === "admin";
  document.querySelectorAll("[data-admin-only]").forEach((element) => { element.hidden = !isAdmin; });
  document.querySelector(".content").classList.toggle("member-layout", !isAdmin);
  loadChatHistory();
  if (isAdmin) {
    loadHeldJobs();
    loadMembers();
  }
}

async function authJson(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(responseError(payload, "Authentication request failed."));
  return payload;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-password-toggle]");
  if (!button) return;
  const input = document.getElementById(button.getAttribute("aria-controls"));
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  button.dataset.visible = showing ? "false" : "true";
  button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  button.title = showing ? "Show password" : "Hide password";
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await authJson("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: document.querySelector("#login-email").value, password: document.querySelector("#login-password").value }) });
    applyAuthenticatedUser(payload);
    loginForm.reset();
  } catch (error) { authMessage.textContent = error.message; }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await authJson("/v1/auth/register", { method: "POST", body: JSON.stringify({
      display_name: document.querySelector("#register-name").value,
      email: document.querySelector("#register-email").value,
      password: document.querySelector("#register-password").value,
      organization_name: document.querySelector("#organization-name").value,
    }) });
    authMessage.textContent = payload.message;
    registerForm.hidden = true;
    loginForm.hidden = false;
  } catch (error) { authMessage.textContent = error.message; }
});

authModeToggle.addEventListener("click", () => {
  const showRegister = registerForm.hidden;
  registerForm.hidden = !showRegister;
  loginForm.hidden = showRegister;
  authModeToggle.textContent = showRegister ? "Already have an account? Sign in" : "Create an organization account";
});

document.querySelector("#forgot-password-button").addEventListener("click", async () => {
  const email = document.querySelector("#login-email").value;
  if (!email) return (authMessage.textContent = "Enter your email first.");
  try { authMessage.textContent = (await authJson("/v1/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) })).message; }
  catch (error) { authMessage.textContent = error.message; }
});

logoutButton.addEventListener("click", async () => {
  try { await authJson("/v1/auth/logout", { method: "POST" }); } catch {}
  accessToken = null;
  currentUser = null;
  setSettingsOpen(false);
  authGate.hidden = false;
  updateTenantChip();
});

async function loadMembers() {
  if (currentUser?.role !== "admin") return;
  const response = await fetch("/v1/admin/organization/members", { headers: requestHeaders() });
  if (!response.ok) return;
  const members = await response.json();
  memberList.innerHTML = members.map((member) => `<div class="held-job"><span><strong>${escapeHtml(member.display_name)}</strong><small>${escapeHtml(member.email)} · ${member.role}${member.active ? "" : " · inactive"}</small>${member.active ? `<span><button class="text-button" data-member-action="role" data-user-id="${member.user_id}" data-role="${member.role}">Make ${member.role === "admin" ? "member" : "admin"}</button><button class="text-button" data-member-action="revoke" data-user-id="${member.user_id}">Revoke sessions</button><button class="text-button" data-member-action="deactivate" data-user-id="${member.user_id}">Deactivate</button></span>` : ""}</span></div>`).join("");
}

refreshMembers.addEventListener("click", loadMembers);
inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const response = await fetch("/v1/admin/organization/invitations", { method: "POST", headers: { ...requestHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ email: document.querySelector("#invite-email").value, role: document.querySelector("#invite-role").value }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(responseError(payload, "Unable to send invitation."));
    memberMessage.textContent = payload.message;
    inviteLinkPanel.hidden = !payload.invitation_url;
    inviteLink.value = payload.invitation_url || "";
    inviteForm.reset();
  } catch (error) { memberMessage.textContent = error.message; }
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
  let path = `/v1/admin/organization/members/${userId}/${action === "role" ? "role" : action === "revoke" ? "revoke-sessions" : "deactivate"}`;
  const options = { method: action === "role" ? "PATCH" : "POST", headers: { ...requestHeaders(), "Content-Type": "application/json" } };
  if (action === "role") options.body = JSON.stringify({ role: button.dataset.role === "admin" ? "member" : "admin" });
  const response = await fetch(path, options);
  const payload = await response.json();
  memberMessage.textContent = response.ok ? "Member updated." : responseError(payload, "Unable to update member.");
  await loadMembers();
});

async function handleActionLink() {
  const params = new URLSearchParams(location.search);
  try {
    if (params.get("verify")) authMessage.textContent = (await authJson("/v1/auth/verify-email", { method: "POST", body: JSON.stringify({ token: params.get("verify") }) })).message;
    if (params.get("reset")) {
      pendingAccountAction = { type: "reset", token: params.get("reset") };
      loginForm.hidden = true; registerForm.hidden = true; accountActionForm.hidden = false; authModeToggle.hidden = true;
      authMessage.textContent = "Choose a new password for your account.";
    }
    if (params.get("invite")) {
      pendingAccountAction = { type: "invite", token: params.get("invite") };
      loginForm.hidden = true; registerForm.hidden = true; accountActionForm.hidden = false; actionNameField.hidden = false; authModeToggle.hidden = true;
      document.querySelector("#action-name").required = true;
      authMessage.textContent = "Create your invited organization account.";
    }
    if (params.get("verify")) history.replaceState({}, "", location.pathname);
  } catch (error) { authMessage.textContent = error.message; }
}

accountActionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingAccountAction) return;
  const password = document.querySelector("#action-password").value;
  const path = pendingAccountAction.type === "invite" ? "/v1/auth/accept-invitation" : "/v1/auth/reset-password";
  const body = { token: pendingAccountAction.token, password };
  if (pendingAccountAction.type === "invite") body.display_name = document.querySelector("#action-name").value;
  try {
    authMessage.textContent = (await authJson(path, { method: "POST", body: JSON.stringify(body) })).message;
    pendingAccountAction = null;
    accountActionForm.reset(); accountActionForm.hidden = true; actionNameField.hidden = true;
    loginForm.hidden = false; authModeToggle.hidden = false;
    history.replaceState({}, "", location.pathname);
  } catch (error) { authMessage.textContent = error.message; }
});

async function bootstrapAuthentication() {
  updateTenantChip();
  await handleActionLink();
  try { applyAuthenticatedUser(await authJson("/v1/auth/refresh", { method: "POST", body: "{}" })); }
  catch { authGate.hidden = false; }
}

bootstrapAuthentication();
