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
const chatHistoryList = document.querySelector("#chat-history-list");
const chatHistoryEmpty = document.querySelector("#chat-history-empty");
const newChatButton = document.querySelector("#new-chat-button");
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

function applyAuthenticatedUser(payload) {
  accessToken = payload.access_token;
  currentUser = payload.user;
  authGate.hidden = true;
  updateTenantChip();
  accountSummary.textContent = `${currentUser.display_name} · ${currentUser.role} at ${currentUser.organization.name}`;
  const isAdmin = currentUser.role === "admin";
  document.querySelectorAll("[data-admin-only]").forEach((element) => { element.hidden = !isAdmin; });
  document.querySelectorAll("[data-super-admin-only]").forEach((element) => { element.hidden = !currentUser.is_super_admin; });
  loadChatHistory();
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
