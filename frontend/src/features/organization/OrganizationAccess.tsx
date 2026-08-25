import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  inviteMember,
  listMembers,
  organizationKeys,
  updateMember,
} from "./api";

export function OrganizationAccess() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const members = useQuery({
    queryKey: organizationKeys.members,
    queryFn: listMembers,
  });
  const update = useMutation({
    mutationFn: ({
      userId,
      action,
      role,
    }: {
      userId: string;
      action: "role" | "revoke" | "deactivate";
      role?: string;
    }) => updateMember(userId, action, role),
    onSuccess: async () => {
      setMessage("Member updated.");
      await queryClient.invalidateQueries({
        queryKey: organizationKeys.members,
      });
    },
  });
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const email = form.get("email");
    const role = form.get("role");
    if (typeof email !== "string" || typeof role !== "string") return;
    try {
      const result = await inviteMember({ email, role });
      setMessage(result.message);
      setInviteLink(result.invitation_url ?? "");
      element.reset();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to create invitation.",
      );
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setMessage("Invitation link copied. It expires in 72 hours.");
    } catch {
      setMessage("Select and copy the invitation link.");
    }
  }
  return (
    <section
      id="members"
      className="admin-card members-card"
      aria-labelledby="members-title"
    >
      <div className="compute-heading">
        <div className="panel-header">
          <span className="step-number">04</span>
          <div>
            <span className="section-kicker">People and permissions</span>
            <h2 id="members-title">Organization access</h2>
          </div>
        </div>
        <button
          className="icon-text-button"
          type="button"
          onClick={() => void members.refetch()}
        >
          Refresh
        </button>
      </div>
      <div className="members-layout">
        <div className="invite-pane">
          <h3>Invite a teammate</h3>
          <p>Generate a secure link and share it directly.</p>
          <form
            className="invite-form"
            onSubmit={(event) => void invite(event)}
          >
            <input
              name="email"
              type="email"
              placeholder="person@example.com"
              aria-label="Email"
              required
            />
            <select name="role" aria-label="Role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="primary-button" type="submit">
              Create invitation
            </button>
          </form>
          <p role="status">
            {message ||
              (members.error instanceof Error ? members.error.message : "")}
          </p>
          {inviteLink && (
            <div className="invite-link-panel">
              <input
                type="text"
                value={inviteLink}
                readOnly
                aria-label="Invitation link"
                onFocus={(event) => event.target.select()}
              />
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copy()}
              >
                Copy link
              </button>
            </div>
          )}
        </div>
        <div className="member-pane">
          <div className="held-jobs member-list">
            {members.isPending && <small>Loading members…</small>}
            {members.data?.map((member) => (
              <div className="held-job member-row" key={member.user_id}>
                <span>
                  <strong>{member.display_name}</strong>
                  <small>
                    {member.email} · {member.role}
                    {member.active ? "" : " · inactive"}
                  </small>
                  {member.active && (
                    <span className="member-actions">
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          update.mutate({
                            userId: member.user_id,
                            action: "role",
                            role: member.role === "admin" ? "member" : "admin",
                          })
                        }
                      >
                        Make {member.role === "admin" ? "member" : "admin"}
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          update.mutate({
                            userId: member.user_id,
                            action: "revoke",
                          })
                        }
                      >
                        Revoke sessions
                      </button>
                      <button
                        className="text-button danger-action"
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `Deactivate ${member.display_name}? Their sessions will be revoked.`,
                            )
                          )
                            update.mutate({
                              userId: member.user_id,
                              action: "deactivate",
                            });
                        }}
                      >
                        Deactivate
                      </button>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
