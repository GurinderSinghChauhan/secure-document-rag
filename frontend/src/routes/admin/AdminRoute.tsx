import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { AppShell } from "../../components/layout/AppShell";
import {
  ComputeQueue,
  computeKeys,
  listQueueJobs,
} from "../../features/compute";
import { Icon, type IconName, Panel, PanelHeader } from "../../components/ui";
import {
  DocumentLibrary,
  DocumentUploader,
  documentKeys,
  listDocuments,
} from "../../features/documents";
import {
  OrganizationAccess,
  organizationKeys,
  listMembers,
} from "../../features/organization";
import { useAuth } from "../../features/auth";

export default function AdminRoute() {
  const { user } = useAuth();
  const [computeSessionId, setComputeSessionId] = useState<string | null>(null);
  const [queue, documents, members] = useQueries({
    queries: [
      { queryKey: computeKeys.queue, queryFn: listQueueJobs },
      { queryKey: documentKeys.indexed, queryFn: listDocuments },
      { queryKey: organizationKeys.members, queryFn: listMembers },
    ],
  });
  const trialDisabled = !user?.is_super_admin && !user?.trial.active;
  const trialText = user?.is_super_admin
    ? "Platform access · no trial limits"
    : user?.trial.active
      ? `Free trial · ends ${new Date(user.trial.ends_at).toLocaleDateString()}`
      : "Trial ended · processing unavailable";
  return (
    <AppShell section="Admin">
      <main id="main-content" className="admin-content">
        <header className="admin-page-header">
          <div>
            <span className="section-kicker">Organization administration</span>
            <h1>Executive operations center</h1>
            <p>
              Monitor intake, enforce policy boundaries, and keep the knowledge
              estate available to the right teams without sacrificing operational
              control.
            </p>
          </div>
        </header>
        <section className="admin-overview" aria-label="Workspace overview">
          <Overview icon="building" label="Access plan" value={trialText} />
          <Overview
            icon="queue"
            label="Active jobs"
            value={String(queue.data?.length ?? "—")}
          />
          <Overview
            icon="documents"
            label="Indexed docs"
            value={String(documents.data?.length ?? "—")}
          />
          <Overview
            icon="members"
            label="Authorized users"
            value={String(members.data?.length ?? "—")}
          />
        </section>
        <div className="admin-grid">
          <Panel
            id="documents"
            className="workflow-card document-workflow-card"
            labelledBy="document-workflow-title"
          >
            <PanelHeader
              step="01"
              kicker="Document workflow"
              title="Upload and index"
              titleId="document-workflow-title"
            />
            <div className="document-workflow-layout">
              <DocumentUploader
                disabled={trialDisabled}
                onComputeStarted={setComputeSessionId}
              />
              <ComputeQueue
                disabled={trialDisabled}
                sessionId={computeSessionId}
                onSessionIdChange={setComputeSessionId}
              />
            </div>
          </Panel>
          <DocumentLibrary onComputeStarted={setComputeSessionId} />
          <OrganizationAccess />
          <section className="trust-note admin-trust">
            <div className="trust-note-heading">
              <span className="security-shield" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Trust and governance</strong>
                <small>
                  Tenant isolation, role enforcement, activity visibility, and
                  bounded processing keep the environment suitable for regulated
                  teams.
                </small>
              </div>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function Overview({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <div className="overview-card">
      <span className="overview-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
