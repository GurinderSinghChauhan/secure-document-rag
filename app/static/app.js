const form = document.querySelector("#chat-form");
const question = document.querySelector("#question");
const tenantId = document.querySelector("#tenant-id");
const apiKey = document.querySelector("#api-key");
const chatLog = document.querySelector("#chat-log");
const sendButton = document.querySelector("#send-button");
const status = document.querySelector("#status");
const settingsToggle = document.querySelector("#settings-toggle");
const settingsPanel = document.querySelector("#settings-panel");
const uploadForm = document.querySelector("#upload-form");
const documentFile = document.querySelector("#document-file");
const allowedRoles = document.querySelector("#allowed-roles");
const allowedUsers = document.querySelector("#allowed-users");
const uploadButton = document.querySelector("#upload-button");
const uploadStatus = document.querySelector("#upload-status");

tenantId.value = sessionStorage.getItem("secure-rag.tenant-id") || "";
apiKey.value = sessionStorage.getItem("secure-rag.api-key") || "";

settingsToggle.addEventListener("click", () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsToggle.setAttribute("aria-expanded", String(!settingsPanel.hidden));
});

function addMessage(text, type) {
  const message = document.createElement("article");
  message.className = `message ${type}-message`;
  const content = document.createElement("p");
  content.textContent = text;
  message.append(content);

  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  question.disabled = isBusy;
  status.textContent = isBusy ? "Searching authorized documents…" : "Ready";
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
  settingsPanel.hidden = false;
  settingsToggle.setAttribute("aria-expanded", "true");
  addMessage("Enter a tenant ID and API key in Connection settings before continuing.", "error");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userQuestion = question.value.trim();
  const { tenant: selectedTenant, apiKey: selectedApiKey } = connectionSettings();

  if (!selectedTenant || !selectedApiKey) {
    showConnectionError();
    return;
  }

  if (userQuestion.length < 3) {
    addMessage("Please enter a question with at least three characters.", "error");
    return;
  }

  sessionStorage.setItem("secure-rag.tenant-id", selectedTenant);
  sessionStorage.setItem("secure-rag.api-key", selectedApiKey);
  addMessage(userQuestion, "user");
  question.value = "";
  setBusy(true);

  try {
    const response = await fetch("/v1/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...requestHeaders(selectedTenant, selectedApiKey),
      },
      body: JSON.stringify({ question: userQuestion }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const detail = Array.isArray(payload.detail) ? payload.detail[0]?.msg : payload.detail;
      throw new Error(typeof detail === "string" ? detail : "Unable to complete the request.");
    }
    addMessage(payload.answer, "assistant");
  } catch (error) {
    addMessage(error.message || "Unable to connect to the RAG service.", "error");
  } finally {
    setBusy(false);
    question.focus();
  }
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
    uploadStatus.textContent = "Select a document first.";
    return;
  }

  sessionStorage.setItem("secure-rag.tenant-id", selectedTenant);
  sessionStorage.setItem("secure-rag.api-key", selectedApiKey);
  uploadButton.disabled = true;
  uploadStatus.textContent = `Indexing ${file.name}…`;

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
    if (!response.ok) {
      const detail = Array.isArray(payload.detail) ? payload.detail[0]?.msg : payload.detail;
      throw new Error(typeof detail === "string" ? detail : "Unable to index the document.");
    }
    uploadStatus.textContent = `Indexed ${payload.chunks_indexed} chunks.`;
    documentFile.value = "";
  } catch (error) {
    uploadStatus.textContent = error.message || "Unable to index the document.";
  } finally {
    uploadButton.disabled = false;
  }
});
