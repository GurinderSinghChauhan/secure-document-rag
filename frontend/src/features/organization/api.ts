import { api } from "../../api/client";
import type { Member } from "../../api/types";

export const organizationKeys = {
  members: ["organization", "members"] as const,
};
export const listMembers = () =>
  api.json<Member[]>(
    "/v1/admin/organization/members",
    {},
    "Unable to load members.",
  );
export const inviteMember = (input: { email: string; role: string }) =>
  api.json<{ message: string; invitation_url?: string }>(
    "/v1/admin/organization/invitations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "Unable to create invitation.",
  );
export function updateMember(
  userId: string,
  action: "role" | "revoke" | "deactivate",
  role?: string,
) {
  const suffix =
    action === "role"
      ? "role"
      : action === "revoke"
        ? "revoke-sessions"
        : "deactivate";
  return api.json<unknown>(
    `/v1/admin/organization/members/${userId}/${suffix}`,
    {
      method: action === "role" ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      ...(action === "role" ? { body: JSON.stringify({ role }) } : {}),
    },
    "Unable to update member.",
  );
}
