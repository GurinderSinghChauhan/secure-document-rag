import { useState, type FormEvent } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth";
import type { ChatResponseReview, Member } from "../../api/types";
import {
  Badge,
  Button,
  Input,
  Select,
  StatusMessage,
  Textarea,
} from "../../components/ui";
import {
  listOrganizations,
  listResponses,
  getDisplaySettings,
  platformKeys,
  revokeUserSessions,
  saveEvaluation,
  setOrganizationStatus,
  setDisplaySettings,
  setUserRole,
  setUserStatus,
} from "./api";

export function PlatformOversight() {
  const [tab, setTab] = useState("organizations");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [message, setMessage] = useState("");
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const organizations = useQuery({
    queryKey: platformKeys.organizations,
    queryFn: listOrganizations,
  });
  const responses = useQuery({
    queryKey: platformKeys.responses(status),
    queryFn: () => listResponses(status),
    enabled: tab === "quality",
  });
  const displaySettings = useQuery({
    queryKey: platformKeys.displaySettings,
    queryFn: getDisplaySettings,
    enabled: tab === "display",
  });
  const change = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: async () => {
      setMessage("Platform change applied.");
      await queryClient.invalidateQueries({
        queryKey: platformKeys.organizations,
      });
    },
    onError: (error) => setMessage(error.message),
  });
  const changeDisplaySettings = useMutation({
    mutationFn: setDisplaySettings,
    onSuccess: async (settings) => {
      queryClient.setQueryData(platformKeys.displaySettings, settings);
      setMessage("Display settings updated.");
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => setMessage(error.message),
  });
  const filtered = (organizations.data ?? []).filter((organization) =>
    `${organization.name} ${organization.slug} ${organization.users.map((member) => `${member.display_name} ${member.email}`).join(" ")}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const users = (organizations.data ?? []).flatMap(
    (organization) => organization.users,
  );
  return (
    <main className="platform-content">
      <header className="admin-page-header">
        <div>
          <span className="section-kicker">Platform administration</span>
          <h1>Platform oversight</h1>
          <p>
            Manage access and review the quality of document-grounded chat
            responses. Platform actions are recorded in the audit log.
          </p>
        </div>
        <Button
          variant="secondary"
          type="button"
          onClick={() =>
            void (tab === "quality"
              ? responses.refetch()
              : tab === "display"
                ? displaySettings.refetch()
                : organizations.refetch())
          }
        >
          Refresh
        </Button>
      </header>
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="platform-tabs" aria-label="Platform tools">
          <Tabs.Trigger className="platform-tab" value="organizations">
            Organizations and access
          </Tabs.Trigger>
          <Tabs.Trigger className="platform-tab" value="quality">
            Response quality
          </Tabs.Trigger>
          <Tabs.Trigger className="platform-tab" value="display">
            Display settings
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="organizations">
          <section className="platform-summary" aria-label="Platform summary">
            <Summary
              value={organizations.data?.length ?? 0}
              label="Organizations"
            />
            <Summary value={users.length} label="Users" />
            <Summary
              value={users.filter((item) => item.active).length}
              label="Active users"
            />
            <Summary
              value={
                (organizations.data ?? []).filter((item) => !item.active).length
              }
              label="Suspended organizations"
            />
          </section>
          <div className="platform-toolbar">
            <label className="platform-search">
              <span className="sr-only">Search organizations and users</span>
              <Input
                type="search"
                placeholder="Search organization, person, or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <StatusMessage>
              {organizations.isPending
                ? "Loading organizations…"
                : organizations.error instanceof Error
                  ? organizations.error.message
                  : message ||
                    `${filtered.length} of ${organizations.data?.length ?? 0} organizations shown.`}
            </StatusMessage>
          </div>
          <div className="organization-list" aria-live="polite">
            {filtered.map((organization) => (
              <article
                className={`organization-card ${organization.active ? "" : "suspended"}`}
                key={organization.organization_id}
              >
                <header className="organization-header">
                  <div className="organization-title">
                    <div className="organization-meta">
                      <Badge
                        variant={organization.active ? "active" : "suspended"}
                      >
                        {organization.active ? "Active" : "Suspended"}
                      </Badge>
                      <Badge variant="metric">
                        {organization.user_count} users
                      </Badge>
                      <Badge variant="metric">
                        {organization.document_count} documents
                      </Badge>
                      <Badge variant="metric">
                        {organization.held_job_count} held jobs
                      </Badge>
                    </div>
                    <h2>{organization.name}</h2>
                    <small>
                      {organization.slug} · {organization.organization_id}
                    </small>
                  </div>
                  <Button
                    variant={organization.active ? "danger" : "secondary"}
                    type="button"
                    onClick={() => {
                      const active = !organization.active;
                      if (
                        confirm(
                          `${active ? "Reactivate" : "Suspend"} this organization?${active ? "" : " All non-super-admin sessions will be revoked."}`,
                        )
                      )
                        change.mutate(() =>
                          setOrganizationStatus(
                            organization.organization_id,
                            active,
                          ),
                        );
                    }}
                  >
                    {organization.active
                      ? "Suspend organization"
                      : "Reactivate organization"}
                  </Button>
                </header>
                {organization.users.length ? (
                  <div className="user-table-wrap">
                    <table className="user-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Organization role</th>
                          <th>Status</th>
                          <th>Controls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {organization.users.map((member) => (
                          <UserRow
                            key={member.user_id}
                            member={member}
                            currentUserId={currentUser?.user_id ?? ""}
                            mutate={(operation) => change.mutate(operation)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-platform">
                    No users in this organization.
                  </p>
                )}
              </article>
            ))}
            {!filtered.length && !organizations.isPending && (
              <p className="empty-platform">
                No organizations or users match this search.
              </p>
            )}
          </div>
        </Tabs.Content>
        <Tabs.Content value="quality">
          <div className="quality-toolbar">
            <div>
              <h2>Chat response evaluator</h2>
              <p>
                Score correctness, relevance, and clarity from 1 (poor) to 5
                (excellent).
              </p>
            </div>
            <label>
              Status{" "}
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="pending">Pending review</option>
                <option value="evaluated">Evaluated</option>
                <option value="all">All responses</option>
              </Select>
            </label>
          </div>
          <StatusMessage className="quality-message">
            {responses.isPending
              ? "Loading responses…"
              : responses.error instanceof Error
                ? responses.error.message
                : `${responses.data?.length ?? 0} responses shown.`}
          </StatusMessage>
          <div className="response-list" aria-live="polite">
            {responses.data?.map((item) => (
              <EvaluationCard
                key={item.response_message_id}
                item={item}
                onSaved={() => {
                  void queryClient.invalidateQueries({
                    queryKey: platformKeys.responses(status),
                  });
                }}
              />
            ))}
            {!responses.data?.length && !responses.isPending && (
              <p className="empty-platform">
                No responses match this review status.
              </p>
            )}
          </div>
        </Tabs.Content>
        <Tabs.Content value="display">
          <section
            className="platform-settings-panel"
            aria-labelledby="platform-display-settings-title"
          >
            <header>
              <div>
                <span className="section-kicker">Document intelligence</span>
                <h2 id="platform-display-settings-title">Table display</h2>
                <p>
                  Choose which classification details users can see in document
                  tables across every organization.
                </p>
              </div>
              <Badge variant="metric">Platform-wide</Badge>
            </header>
            {displaySettings.isPending ? (
              <StatusMessage>Loading display settings…</StatusMessage>
            ) : displaySettings.error instanceof Error ? (
              <StatusMessage>{displaySettings.error.message}</StatusMessage>
            ) : (
              <label className="platform-setting-row">
                <span>
                  <strong>Show classification confidence</strong>
                  <small>
                    Add a sortable confidence percentage column to every
                    document data table. Manual classifications without a score
                    display an em dash.
                  </small>
                </span>
                <Input
                  type="checkbox"
                  role="switch"
                  aria-label="Show classification confidence in document tables"
                  checked={
                    displaySettings.data?.show_classification_confidence ?? false
                  }
                  disabled={changeDisplaySettings.isPending}
                  onChange={(event) =>
                    changeDisplaySettings.mutate(event.target.checked)
                  }
                />
              </label>
            )}
            {message && <StatusMessage>{message}</StatusMessage>}
          </section>
        </Tabs.Content>
      </Tabs.Root>
    </main>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function UserRow({
  member,
  currentUserId,
  mutate,
}: {
  member: Member;
  currentUserId: string;
  mutate: (operation: () => Promise<unknown>) => void;
}) {
  return (
    <tr>
      <td>
        <div className="user-identity">
          <strong>{member.display_name}</strong>
          <small>{member.email}</small>
        </div>
      </td>
      <td>
        <div className="user-role">
          <Select
            value={member.role}
            aria-label={`Role for ${member.display_name}`}
            onChange={(event) => {
              const role = event.target.value;
              if (
                confirm(
                  `Change this user's organization role to ${role}? Their sessions will be revoked.`,
                )
              )
                mutate(() => setUserRole(member.user_id, role));
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
          {member.is_super_admin && <Badge variant="super">SUPER ADMIN</Badge>}
        </div>
      </td>
      <td>
        <Badge variant={member.active ? "active" : "suspended"}>
          {member.active ? "Active" : "Deactivated"}
        </Badge>
      </td>
      <td>
        <div className="user-actions">
          <Button
            variant="secondary"
            className="compact"
            type="button"
            onClick={() => {
              if (confirm("Revoke every active session for this user?"))
                mutate(() => revokeUserSessions(member.user_id));
            }}
          >
            Revoke sessions
          </Button>
          <Button
            variant={member.active ? "danger" : "secondary"}
            className={member.active ? undefined : "compact"}
            type="button"
            disabled={member.user_id === currentUserId && member.active}
            title={
              member.user_id === currentUserId && member.active
                ? "You cannot deactivate yourself"
                : undefined
            }
            onClick={() => {
              const active = !member.active;
              if (
                confirm(
                  `${active ? "Reactivate" : "Deactivate"} this user? Their sessions will be revoked.`,
                )
              )
                mutate(() => setUserStatus(member.user_id, active));
            }}
          >
            {member.active ? "Deactivate" : "Reactivate"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function EvaluationCard({
  item,
  onSaved,
}: {
  item: ChatResponseReview;
  onSaved: () => void;
}) {
  const save = useMutation({
    mutationFn: (input: {
      correctness: number;
      relevance: number;
      clarity: number;
      notes: string;
    }) => saveEvaluation(item.response_message_id, input),
    onSuccess: () => onSaved(),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const notes = form.get("notes");
    save.mutate({
      correctness: Number(form.get("correctness")),
      relevance: Number(form.get("relevance")),
      clarity: Number(form.get("clarity")),
      notes: typeof notes === "string" ? notes : "",
    });
  }
  return (
    <article className="response-card">
      <header>
        <div>
          <Badge variant="metric">{item.organization_name}</Badge>
          {item.evaluation ? (
            <Badge variant="score">{item.evaluation.overall} / 5</Badge>
          ) : (
            <Badge variant="suspended">Pending</Badge>
          )}
          <h3>{item.chat_title}</h3>
          <small>
            {item.user_name} · {new Date(item.created_at).toLocaleString()}
          </small>
        </div>
      </header>
      <div className="response-context">
        <section>
          <strong>Question</strong>
          <p>{item.question}</p>
        </section>
        <section>
          <strong>Assistant response</strong>
          <p>{item.answer}</p>
        </section>
      </div>
      <form
        className="evaluation-form"
        onSubmit={(event) => void submit(event)}
      >
        <div className="rating-grid">
          {(["correctness", "relevance", "clarity"] as const).map((name) => (
            <label key={name}>
              {name[0]?.toUpperCase()}
              {name.slice(1)}
              <Select
                name={name}
                defaultValue={item.evaluation?.[name] ?? 3}
                required
              >
                {[1, 2, 3, 4, 5].map((score) => (
                  <option value={score} key={score}>
                    {score}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>
        <label>
          Reviewer notes
          <Textarea
            name="notes"
            maxLength={2000}
            rows={3}
            defaultValue={item.evaluation?.notes ?? ""}
            placeholder="Record factual issues, missing context, or improvement ideas"
          />
        </label>
        {save.error && <p role="alert">{save.error.message}</p>}
        <Button
          variant="primary"
          type="submit"
          busy={save.isPending}
          busyLabel="Saving…"
        >
          {item.evaluation ? "Update evaluation" : "Save evaluation"}
        </Button>
      </form>
    </article>
  );
}
