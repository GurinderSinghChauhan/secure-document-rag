import { api } from "../../api/client";
import type { ChatResponseReview, PlatformOrganization } from "../../api/types";

export const platformKeys = {
  organizations: ["platform", "organizations"] as const,
  responses: (status: string) => ["platform", "responses", status] as const,
};
export const listOrganizations = () =>
  api.json<PlatformOrganization[]>(
    "/v1/super-admin/organizations",
    {},
    "Unable to load organizations.",
  );
export const listResponses = (status: string) =>
  api.json<ChatResponseReview[]>(
    `/v1/super-admin/chat-responses?status=${encodeURIComponent(status)}`,
    {},
    "Unable to load chat responses.",
  );
export const setOrganizationStatus = (id: string, active: boolean) =>
  api.json<unknown>(`/v1/super-admin/organizations/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
export const setUserStatus = (id: string, active: boolean) =>
  api.json<unknown>(`/v1/super-admin/users/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
export const setUserRole = (id: string, role: string) =>
  api.json<unknown>(`/v1/super-admin/users/${id}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
export const revokeUserSessions = (id: string) =>
  api.json<unknown>(`/v1/super-admin/users/${id}/revoke-sessions`, {
    method: "POST",
  });
export const saveEvaluation = (
  id: string,
  input: {
    correctness: number;
    relevance: number;
    clarity: number;
    notes: string;
  },
) =>
  api.json<unknown>(
    `/v1/super-admin/chat-responses/${id}/evaluation`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "Unable to save evaluation.",
  );
