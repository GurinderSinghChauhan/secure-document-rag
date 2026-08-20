let accessToken = null;
let currentUser = null;
let organizations = [];

const loading = document.querySelector("#platform-loading");
const shell = document.querySelector("#platform-shell");
const userName = document.querySelector("#platform-user-name");
const logoutButton = document.querySelector("#platform-logout");
const refreshButton = document.querySelector("#refresh-platform");
const searchInput = document.querySelector("#platform-search");
const message = document.querySelector("#platform-message");
const organizationList = document.querySelector("#organization-list");
const organizationCount = document.querySelector("#organization-count");
const userCount = document.querySelector("#user-count");
const activeUserCount = document.querySelector("#active-user-count");
const suspendedCount = document.querySelector("#suspended-count");
const organizationsView = document.querySelector("#organizations-view");
const qualityView = document.querySelector("#quality-view");
const statusFilter = document.querySelector("#evaluation-status");
const qualityMessage = document.querySelector("#quality-message");
const responseList = document.querySelector("#response-list");

function headers(json = false) {
  return { Authorization: `Bearer ${accessToken}`, ...(json ? { "Content-Type": "application/json" } : {}) };
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function responseError(payload, fallback) {
  const detail = Array.isArray(payload.detail) ? payload.detail[0]?.msg : payload.detail;
  return typeof detail === "string" ? detail : fallback;
}

async function authJson(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(responseError(payload, "Authentication request failed."));
  return payload;
}

function renderSummary() {
  const users = organizations.flatMap((organization) => organization.users);
  organizationCount.textContent = organizations.length;
  userCount.textContent = users.length;
  activeUserCount.textContent = users.filter((user) => user.active).length;
  suspendedCount.textContent = organizations.filter((organization) => !organization.active).length;
}

function userRow(user) {
  const isSelf = user.user_id === currentUser.user_id;
  return `<tr>
    <td><div class="user-identity"><strong>${escapeHtml(user.display_name)}</strong><small>${escapeHtml(user.email)}</small></div></td>
    <td><div class="user-role"><select data-action="role" data-user-id="${user.user_id}" aria-label="Role for ${escapeHtml(user.display_name)}"><option value="member"${user.role === "member" ? " selected" : ""}>Member</option><option value="admin"${user.role === "admin" ? " selected" : ""}>Admin</option></select>${user.is_super_admin ? '<span class="super-badge">SUPER ADMIN</span>' : ""}</div></td>
    <td><span class="status-pill ${user.active ? "active" : "suspended"}">${user.active ? "Active" : "Deactivated"}</span></td>
    <td><div class="user-actions"><button class="secondary-button compact" data-action="revoke" data-user-id="${user.user_id}" type="button">Revoke sessions</button><button class="${user.active ? "danger-button" : "secondary-button compact"}" data-action="status" data-user-id="${user.user_id}" data-active="${user.active ? "false" : "true"}" type="button"${isSelf && user.active ? " disabled title=\"You cannot deactivate yourself\"" : ""}>${user.active ? "Deactivate" : "Reactivate"}</button></div></td>
  </tr>`;
}

function organizationCard(organization) {
  return `<article class="organization-card ${organization.active ? "" : "suspended"}" data-search="${escapeHtml(`${organization.name} ${organization.slug} ${organization.users.map((user) => `${user.display_name} ${user.email}`).join(" ")}`.toLowerCase())}">
    <header class="organization-header">
      <div class="organization-title"><div class="organization-meta"><span class="status-pill ${organization.active ? "active" : "suspended"}">${organization.active ? "Active" : "Suspended"}</span><span class="metric-pill">${organization.user_count} users</span><span class="metric-pill">${organization.document_count} documents</span><span class="metric-pill">${organization.held_job_count} held jobs</span></div><h2>${escapeHtml(organization.name)}</h2><small>${escapeHtml(organization.slug)} · ${escapeHtml(organization.organization_id)}</small></div>
      <div class="organization-actions"><button class="${organization.active ? "danger-button" : "secondary-button"}" data-action="organization-status" data-organization-id="${organization.organization_id}" data-active="${organization.active ? "false" : "true"}" type="button">${organization.active ? "Suspend organization" : "Reactivate organization"}</button></div>
    </header>
    ${organization.users.length ? `<div class="user-table-wrap"><table class="user-table"><thead><tr><th>User</th><th>Organization role</th><th>Status</th><th>Controls</th></tr></thead><tbody>${organization.users.map(userRow).join("")}</tbody></table></div>` : '<p class="empty-platform">No users in this organization.</p>'}
  </article>`;
}

function renderOrganizations() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = query
    ? organizations.filter((organization) => `${organization.name} ${organization.slug} ${organization.users.map((user) => `${user.display_name} ${user.email}`).join(" ")}`.toLowerCase().includes(query))
    : organizations;
  organizationList.innerHTML = filtered.length ? filtered.map(organizationCard).join("") : '<p class="empty-platform">No organizations or users match this search.</p>';
  message.textContent = `${filtered.length} of ${organizations.length} organizations shown.`;
  renderSummary();
}

async function loadOrganizations() {
  refreshButton.disabled = true;
  message.textContent = "Loading organizations…";
  try {
    const response = await fetch("/v1/super-admin/organizations", { headers: headers() });
    const payload = await response.json();
    if (!response.ok) throw new Error(responseError(payload, "Unable to load organizations."));
    organizations = payload;
    renderOrganizations();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

function ratingSelect(name, selected) {
  return `<label>${name}<select name="${name.toLowerCase()}" required>${[1, 2, 3, 4, 5].map((score) => `<option value="${score}"${Number(selected || 3) === score ? " selected" : ""}>${score}</option>`).join("")}</select></label>`;
}

function responseCard(item) {
  const evaluation = item.evaluation || {};
  return `<article class="response-card"><header><div><span class="metric-pill">${escapeHtml(item.organization_name)}</span>${evaluation.overall ? `<span class="score-pill">${evaluation.overall} / 5</span>` : '<span class="status-pill suspended">Pending</span>'}<h3>${escapeHtml(item.chat_title)}</h3><small>${escapeHtml(item.user_name)} · ${new Date(item.created_at).toLocaleString()}</small></div></header><div class="response-context"><section><strong>Question</strong><p>${escapeHtml(item.question)}</p></section><section><strong>Assistant response</strong><p>${escapeHtml(item.answer)}</p></section></div><form class="evaluation-form" data-response-id="${item.response_message_id}"><div class="rating-grid">${ratingSelect("Correctness", evaluation.correctness)}${ratingSelect("Relevance", evaluation.relevance)}${ratingSelect("Clarity", evaluation.clarity)}</div><label>Reviewer notes<textarea name="notes" maxlength="2000" rows="3" placeholder="Record factual issues, missing context, or improvement ideas">${escapeHtml(evaluation.notes || "")}</textarea></label><button class="primary-button" type="submit">${item.evaluation ? "Update evaluation" : "Save evaluation"}</button></form></article>`;
}

async function loadResponses() {
  qualityMessage.textContent = "Loading responses…";
  responseList.innerHTML = "";
  try {
    const response = await fetch(`/v1/super-admin/chat-responses?status=${encodeURIComponent(statusFilter.value)}`, { headers: headers() });
    const payload = await response.json();
    if (!response.ok) throw new Error(responseError(payload, "Unable to load chat responses."));
    responseList.innerHTML = payload.length ? payload.map(responseCard).join("") : '<p class="empty-platform">No responses match this review status.</p>';
    qualityMessage.textContent = `${payload.length} response${payload.length === 1 ? "" : "s"} shown.`;
  } catch (error) { qualityMessage.textContent = error.message; }
}

document.querySelectorAll(".platform-tab").forEach((tab) => tab.addEventListener("click", async () => {
  const quality = tab.dataset.view === "quality";
  organizationsView.hidden = quality;
  qualityView.hidden = !quality;
  document.querySelectorAll(".platform-tab").forEach((item) => { item.classList.toggle("active", item === tab); item.setAttribute("aria-selected", String(item === tab)); });
  if (quality) await loadResponses();
}));

statusFilter.addEventListener("change", loadResponses);
responseList.addEventListener("submit", async (event) => {
  const form = event.target.closest(".evaluation-form");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  button.disabled = true;
  qualityMessage.textContent = "Saving evaluation…";
  try {
    const response = await fetch(`/v1/super-admin/chat-responses/${form.dataset.responseId}/evaluation`, { method: "PUT", headers: headers(true), body: JSON.stringify({ correctness: Number(data.get("correctness")), relevance: Number(data.get("relevance")), clarity: Number(data.get("clarity")), notes: data.get("notes") }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(responseError(payload, "Unable to save evaluation."));
    await loadResponses();
  } catch (error) { qualityMessage.textContent = error.message; button.disabled = false; }
});

async function mutate(path, options, successMessage) {
  message.textContent = "Applying platform change…";
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(responseError(payload, "Unable to apply platform change."));
  message.textContent = successMessage;
  await loadOrganizations();
}

organizationList.addEventListener("change", async (event) => {
  const control = event.target.closest('[data-action="role"]');
  if (!control) return;
  if (!confirm(`Change this user's organization role to ${control.value}? Their sessions will be revoked.`)) {
    await loadOrganizations();
    return;
  }
  try {
    await mutate(`/v1/super-admin/users/${control.dataset.userId}/role`, { method: "PATCH", headers: headers(true), body: JSON.stringify({ role: control.value }) }, "User role updated.");
  } catch (error) {
    message.textContent = error.message;
    await loadOrganizations();
  }
});

organizationList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.tagName === "SELECT") return;
  const action = button.dataset.action;
  try {
    if (action === "organization-status") {
      const active = button.dataset.active === "true";
      if (!confirm(`${active ? "Reactivate" : "Suspend"} this organization?${active ? "" : " All non-super-admin sessions will be revoked."}`)) return;
      await mutate(`/v1/super-admin/organizations/${button.dataset.organizationId}/status`, { method: "PATCH", headers: headers(true), body: JSON.stringify({ active }) }, `Organization ${active ? "reactivated" : "suspended"}.`);
    }
    if (action === "status") {
      const active = button.dataset.active === "true";
      if (!confirm(`${active ? "Reactivate" : "Deactivate"} this user? Their sessions will be revoked.`)) return;
      await mutate(`/v1/super-admin/users/${button.dataset.userId}/status`, { method: "PATCH", headers: headers(true), body: JSON.stringify({ active }) }, `User ${active ? "reactivated" : "deactivated"}.`);
    }
    if (action === "revoke") {
      if (!confirm("Revoke every active session for this user?")) return;
      await mutate(`/v1/super-admin/users/${button.dataset.userId}/revoke-sessions`, { method: "POST", headers: headers(true) }, "User sessions revoked.");
    }
  } catch (error) {
    message.textContent = error.message;
  }
});

searchInput.addEventListener("input", renderOrganizations);
refreshButton.addEventListener("click", () => qualityView.hidden ? loadOrganizations() : loadResponses());
logoutButton.addEventListener("click", async () => {
  try { await authJson("/v1/auth/logout", { method: "POST" }); } catch {}
  location.replace("/");
});

async function bootstrapPlatform() {
  try {
    const payload = await authJson("/v1/auth/refresh", { method: "POST", body: "{}" });
    if (!payload.user?.is_super_admin) {
      location.replace("/");
      return;
    }
    accessToken = payload.access_token;
    currentUser = payload.user;
    userName.textContent = currentUser.display_name;
    loading.hidden = true;
    shell.hidden = false;
    await loadOrganizations();
  } catch {
    location.replace("/");
  }
}

bootstrapPlatform();
