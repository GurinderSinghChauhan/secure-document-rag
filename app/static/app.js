const form = document.querySelector("#chat-form");
const question = document.querySelector("#question");
const tenantId = document.querySelector("#tenant-id");
const apiKey = document.querySelector("#api-key");
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
const promptSuggestions = document.querySelectorAll("[data-prompt]");

tenantId.value = sessionStorage.getItem("secure-rag.tenant-id") || "";
apiKey.value = sessionStorage.getItem("secure-rag.api-key") || "";

function updateTenantChip() {
  tenantChip.textContent = tenantId.value.trim() || "Not configured";
}

function setSettingsOpen(isOpen) {
  settingsPanel.hidden = !isOpen;
  settingsToggle.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) tenantId.focus();
}

function saveConnectionSettings() {
  const selectedTenant = tenantId.value.trim();
  const selectedApiKey = apiKey.value.trim();
  if (selectedTenant) sessionStorage.setItem("secure-rag.tenant-id", selectedTenant);
  else sessionStorage.removeItem("secure-rag.tenant-id");
  if (selectedApiKey) sessionStorage.setItem("secure-rag.api-key", selectedApiKey);
  else sessionStorage.removeItem("secure-rag.api-key");
  updateTenantChip();
}

settingsToggle.addEventListener("click", () => setSettingsOpen(settingsPanel.hidden));
settingsClose.addEventListener("click", () => setSettingsOpen(false));
settingsDone.addEventListener("click", () => {
  saveConnectionSettings();
  setSettingsOpen(false);
  settingsToggle.focus();
});
tenantId.addEventListener("input", saveConnectionSettings);
apiKey.addEventListener("input", saveConnectionSettings);

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

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  question.disabled = isBusy;
  status.classList.toggle("busy", isBusy);
  status.lastChild.textContent = isBusy ? " Searching authorized documents…" : " Ready to search";
}

function requestHeaders(selectedTenant, selectedApiKey) {
  return {
    "X-API-Key": selectedApiKey,
    "X-Tenant-ID": selectedTenant,
  };
}

function connectionSettings() {
  return {
    tenant: tenantId.value.trim(),
    apiKey: apiKey.value.trim(),
  };
}

function showConnectionError() {
  setSettingsOpen(true);
  addMessage("Enter a tenant ID and API key in Connection before continuing.", "error");
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
      body: JSON.stringify({ question: userQuestion }),
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

promptSuggestions.forEach((button) => {
  button.addEventListener("click", () => {
    question.value = button.dataset.prompt;
    question.focus();
  });
});

function setUploadStatus(message, state = "") {
  uploadStatus.className = `upload-status ${state}`.trim();
  uploadStatus.lastChild.textContent = ` ${message}`;
}

function updateSelectedFile() {
  const file = documentFile.files[0];
  fileLabel.textContent = file ? file.name : "Choose a document";
  setUploadStatus(file ? `${file.name} is ready to upload.` : "Select a file to begin.");
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
  const file = documentFile.files[0];

  if (!selectedTenant || !selectedApiKey) {
    showConnectionError();
    return;
  }
  if (!file) {
    setUploadStatus("Select a document first.", "error");
    return;
  }

  saveConnectionSettings();
  uploadButton.disabled = true;
  setUploadStatus(`Indexing ${file.name}…`, "busy");

  try {
    const headers = {
      ...requestHeaders(selectedTenant, selectedApiKey),
      "X-Document-Name": file.name,
      "Content-Type": file.type || "text/plain",
    };
    if (allowedRoles.value.trim()) headers["X-Allowed-Roles"] = allowedRoles.value.trim();
    if (allowedUsers.value.trim()) headers["X-Allowed-Users"] = allowedUsers.value.trim();

    const response = await fetch("/v1/documents", { method: "POST", headers, body: file });
    const payload = await response.json();
    if (!response.ok) throw new Error(responseError(payload, "Unable to index the document."));
    setUploadStatus(`${file.name} is searchable (${payload.chunks_indexed} chunks).`, "success");
    documentFile.value = "";
    fileLabel.textContent = "Choose another document";
  } catch (error) {
    setUploadStatus(error.message || "Unable to index the document.", "error");
  } finally {
    uploadButton.disabled = false;
  }
});

updateTenantChip();
