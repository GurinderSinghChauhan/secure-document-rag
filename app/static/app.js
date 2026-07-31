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
const emptyChatMarkup = chatLog.innerHTML;
let activeChatId = null;

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
  activeChatId = null;
  resetConversation();
  loadChatHistory();
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

function uploadDocument(file, headers) {
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
          setUploadStatus(payload.message || `Indexing ${file.name}…`, "busy");
        }
      }
    }

    request.open("POST", "/v1/documents/stream");
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setUploadProgress((event.loaded / event.total) * 100);
      setUploadStatus(`Uploading ${file.name}…`, "busy");
    });
    request.upload.addEventListener("load", () => {
      setUploadProgress(100, "success");
      setIndexingProgress(0);
      setUploadStatus(`Upload complete. Starting indexing for ${file.name}…`, "busy");
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
  const file = documentFile.files[0];
  fileLabel.textContent = file ? file.name : "Choose a document";
  setUploadStatus(file ? `${file.name} is ready to upload.` : "Select a file to begin.");
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
  setUploadProgress(0);
  setUploadStatus(`Preparing ${file.name}…`, "busy");

  try {
    const headers = {
      ...requestHeaders(selectedTenant, selectedApiKey),
      "X-Document-Name": file.name,
      "Content-Type": file.type || "text/plain",
    };
    if (allowedRoles.value.trim()) headers["X-Allowed-Roles"] = allowedRoles.value.trim();
    if (allowedUsers.value.trim()) headers["X-Allowed-Users"] = allowedUsers.value.trim();

    const { ok, payload } = await uploadDocument(file, headers);
    if (!ok) throw new Error(responseError(payload, "Unable to index the document."));
    setUploadProgress(100, "success");
    setIndexingProgress(100);
    uploadProgress.classList.add("success");
    setUploadStatus(`${file.name} is searchable (${payload.chunks_indexed} chunks).`, "success");
    documentFile.value = "";
    fileLabel.textContent = "Choose another document";
  } catch (error) {
    if (uploadProgressTrack.getAttribute("aria-valuenow") === "100") indexingProgressRow.classList.add("error");
    else uploadProgress.classList.add("error");
    setUploadStatus(error.message || "Unable to index the document.", "error");
  } finally {
    uploadButton.disabled = false;
  }
});

updateTenantChip();
loadChatHistory();
