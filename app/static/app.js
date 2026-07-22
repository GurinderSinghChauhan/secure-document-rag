const form = document.querySelector("#chat-form");
const question = document.querySelector("#question");
const tenantId = document.querySelector("#tenant-id");
const apiKey = document.querySelector("#api-key");
const chatLog = document.querySelector("#chat-log");
const sendButton = document.querySelector("#send-button");
const status = document.querySelector("#status");
const settingsToggle = document.querySelector("#settings-toggle");
const settingsPanel = document.querySelector("#settings-panel");

tenantId.value = sessionStorage.getItem("secure-rag.tenant-id") || "";
apiKey.value = sessionStorage.getItem("secure-rag.api-key") || "";

settingsToggle.addEventListener("click", () => {
  settingsPanel.hidden = !settingsPanel.hidden;
  settingsToggle.setAttribute("aria-expanded", String(!settingsPanel.hidden));
});

function addMessage(text, type, citations = []) {
  const message = document.createElement("article");
  message.className = `message ${type}-message`;
  const content = document.createElement("p");
  content.textContent = text;
  message.append(content);

  if (citations.length) {
    const list = document.createElement("div");
    list.className = "citation-list";
    for (const citation of citations) {
      const item = document.createElement("div");
      item.className = "citation";
      const title = document.createElement("strong");
      title.textContent = citation.document_name;
      item.append(title, document.createTextNode(` · chunk ${citation.chunk_index + 1} · relevance ${citation.score}`));
      list.append(item);
    }
    message.append(list);
  }

  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  question.disabled = isBusy;
  status.textContent = isBusy ? "Searching authorized documents…" : "Ready";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userQuestion = question.value.trim();
  const selectedTenant = tenantId.value.trim();
  const selectedApiKey = apiKey.value.trim();

  if (!selectedTenant || !selectedApiKey) {
    settingsPanel.hidden = false;
    settingsToggle.setAttribute("aria-expanded", "true");
    addMessage("Enter a tenant ID and API key in Connection settings before sending a question.", "error");
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
        "X-API-Key": selectedApiKey,
        "X-Tenant-ID": selectedTenant,
      },
      body: JSON.stringify({ question: userQuestion }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(typeof payload.detail === "string" ? payload.detail : "Unable to complete the request.");
    }
    addMessage(payload.answer, "assistant", payload.citations || []);
  } catch (error) {
    addMessage(error.message || "Unable to connect to the RAG service.", "error");
  } finally {
    setBusy(false);
    question.focus();
  }
});
