import { useQueries } from "@tanstack/react-query";
import { AppShell } from "../../components/layout/AppShell";
import {
  ComputeQueue,
  computeKeys,
  listHeldJobs,
} from "../../features/compute";
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
  const [held, documents, members] = useQueries({
    queries: [
      { queryKey: computeKeys.held, queryFn: listHeldJobs },
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
    <AppShell
      section="Admin"
      sidebar={
        <>
          <p className="admin-nav-label">Manage</p>
          <nav className="primary-nav" aria-label="Admin sections">
            <a className="nav-item" href="#documents">
              Documents
            </a>
            <a className="nav-item" href="#compute">
              Compute
            </a>
            <a className="nav-item" href="#indexed-documents">
              Indexed library
            </a>
            <a className="nav-item" href="#members">
              Members
            </a>
          </nav>
        </>
      }
    >
      <main className="admin-content">
        <header className="admin-page-header">
          <div>
            <span className="section-kicker">Organization administration</span>
            <h1>Workspace control center</h1>
            <p>
              Bring knowledge in, control when compute runs, and keep access
              accountable.
            </p>
          </div>
        </header>
        <section className="admin-overview" aria-label="Workspace overview">
          <Overview label="Plan" value={trialText} />
          <Overview
            label="Waiting for compute"
            value={String(held.data?.length ?? "—")}
          />
          <Overview
            label="Indexed documents"
            value={String(documents.data?.length ?? "—")}
          />
          <Overview
            label="Organization members"
            value={String(members.data?.length ?? "—")}
          />
        </section>
        <div className="admin-grid">
          <DocumentUploader disabled={trialDisabled} />
          <ComputeQueue disabled={trialDisabled} />
          <DocumentLibrary />
          <OrganizationAccess />
          <section className="trust-note admin-trust">
            <div className="trust-note-heading">
              <span className="security-shield" aria-hidden="true">
                ✓
              </span>
              <div>
                <strong>Security by design</strong>
                <small>
                  Organization isolation, admin authorization, rotating
                  sessions, and bounded compute are enforced by the API.
                </small>
              </div>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function Overview({ label, value }: { label: string; value: string }) {
  return (
    <div className="overview-card">
      <span className="overview-icon" aria-hidden="true">
        ●
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
