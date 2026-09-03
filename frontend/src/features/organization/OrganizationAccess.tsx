import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  inviteMember,
  listMembers,
  organizationKeys,
  updateMember,
} from "./api";
import {
  Button,
  Input,
  Panel,
  PanelHeader,
  Select,
  StatusMessage,
} from "../../components/ui";

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
    <Panel id="members" className="members-card" labelledBy="members-title">
      <PanelHeader
        step="03"
        kicker="People and permissions"
        title="Organization access"
        titleId="members-title"
        action={
          <Button variant="icon-text" onClick={() => void members.refetch()}>
            Refresh
          </Button>
        }
      />
      <div className="members-layout">
        <div className="invite-pane">
          <h3>Invite a teammate</h3>
          <p>Generate a secure link and share it directly.</p>
          <form
            className="invite-form"
            onSubmit={(event) => void invite(event)}
          >
            <Input
              name="email"
              type="email"
              placeholder="person@example.com"
              aria-label="Email"
              required
            />
            <Select name="role" aria-label="Role">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
            <Button variant="primary" type="submit">
              Create invitation
            </Button>
          </form>
          <StatusMessage>
            {message ||
              (members.error instanceof Error ? members.error.message : "")}
          </StatusMessage>
          {inviteLink && (
            <div className="invite-link-panel">
              <Input
                type="text"
                value={inviteLink}
                readOnly
                aria-label="Invitation link"
                onFocus={(event) => event.target.select()}
              />
              <Button
                variant="secondary"
                type="button"
                onClick={() => void copy()}
              >
                Copy link
              </Button>
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
                      <Button
                        variant="text"
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
                      </Button>
                      <Button
                        variant="text"
                        type="button"
                        onClick={() =>
                          update.mutate({
                            userId: member.user_id,
                            action: "revoke",
                          })
                        }
                      >
                        Revoke sessions
                      </Button>
                      <Button
                        variant="text"
                        className="danger-action"
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
                      </Button>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
