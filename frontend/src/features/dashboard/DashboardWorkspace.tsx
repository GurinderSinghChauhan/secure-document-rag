import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../../components/layout/AppShell";
import { Badge, Button, EmptyState, StatusMessage } from "../../components/ui";
import { listDocumentSchemas, schemaKeys } from "../documents/api";
import { dashboardKeys, getDashboard } from "./api";

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DashboardWorkspace() {
  const dashboard = useQuery({
    queryKey: dashboardKeys.overview,
    queryFn: getDashboard,
  });
  const schemas = useQuery({
    queryKey: schemaKeys.all,
    queryFn: listDocumentSchemas,
  });
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const activeIndustry =
    schemas.data?.find(
      (industry) => industry.key === (selectedIndustry ?? schemas.data[0]?.key),
    ) ?? null;

  return (
    <AppShell section="Dashboard">
      <main className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <span className="section-kicker">Structured intelligence</span>
            <h1>Document dashboard</h1>
            <p>
              Review authorized document coverage by industry, explore the
              extraction schema, and inspect structured metadata without opening
              source files.
            </p>
          </div>
        </header>

        <section className="dashboard-summary" aria-label="Document summary">
          <SummaryCard
            label="Authorized documents"
            value={dashboard.data?.total_documents}
          />
          <SummaryCard
            label="Classified"
            value={dashboard.data?.classified_documents}
          />
          <SummaryCard
            label="Metadata extracted"
            value={dashboard.data?.extracted_documents}
          />
          <SummaryCard
            label="Configured verticals"
            value={dashboard.data?.industries.length}
          />
        </section>

        <StatusMessage className="dashboard-status">
          {dashboard.isPending || schemas.isPending
            ? "Loading your authorized document intelligence…"
            : dashboard.error instanceof Error
              ? dashboard.error.message
              : schemas.error instanceof Error
                ? schemas.error.message
                : `${dashboard.data?.classified_documents ?? 0} classified documents across ${dashboard.data?.industries.length ?? 0} configured verticals.`}
        </StatusMessage>

        <section aria-labelledby="industry-title">
          <div className="dashboard-section-heading">
            <div>
              <span className="section-kicker">Coverage</span>
              <h2 id="industry-title">Industry schemas</h2>
            </div>
            <p>Select a vertical to review its supported document types.</p>
          </div>
          <div className="industry-grid">
            {schemas.data?.map((industry) => {
              const summary = dashboard.data?.industries.find(
                (item) => item.key === industry.key,
              );
              const active = industry.key === activeIndustry?.key;
              return (
                <Button
                  className={`industry-card ${active ? "active" : ""}`}
                  type="button"
                  aria-pressed={active}
                  key={industry.key}
                  onClick={() => setSelectedIndustry(industry.key)}
                >
                  <span>{industry.label}</span>
                  <strong>{summary?.document_count ?? 0}</strong>
                  <small>
                    {industry.document_types.length} supported document types
                  </small>
                </Button>
              );
            })}
          </div>
        </section>

        {activeIndustry && (
          <section className="schema-browser" aria-labelledby="schema-title">
            <header>
              <div>
                <span className="section-kicker">Schema catalog</span>
                <h2 id="schema-title">{activeIndustry.label}</h2>
                <p>{activeIndustry.description}</p>
              </div>
              <Badge variant="metric">
                {activeIndustry.document_types.length} types
              </Badge>
            </header>
            <div className="schema-type-grid">
              {activeIndustry.document_types.map((document) => (
                <details className="schema-type-card" key={document.key}>
                  <summary>
                    <span>{document.label}</span>
                    <small>{document.fields.length} fields</small>
                  </summary>
                  <div className="schema-fields">
                    {document.fields.map((field) => (
                      <code key={field}>{field}</code>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="recent-documents-title">
          <div className="dashboard-section-heading">
            <div>
              <span className="section-kicker">Latest activity</span>
              <h2 id="recent-documents-title">Recent documents</h2>
            </div>
            <p>Only documents permitted for your role or user are shown.</p>
          </div>
          {dashboard.data?.recent_documents.length ? (
            <div className="dashboard-document-list">
              {dashboard.data.recent_documents.map((document) => (
                <article
                  className="dashboard-document-card"
                  key={document.document_id}
                >
                  <header>
                    <div>
                      <strong>{document.document_name}</strong>
                      <small>
                        {document.industry_label} ·{" "}
                        {document.document_type_label}
                      </small>
                    </div>
                    <Badge
                      variant={
                        document.extraction_status === "completed"
                          ? "active"
                          : "suspended"
                      }
                    >
                      {document.extraction_status === "completed"
                        ? "Extracted"
                        : document.extraction_status === "failed"
                          ? "Extraction failed"
                          : "Not extracted"}
                    </Badge>
                  </header>
                  {Object.keys(document.extracted_metadata).length > 0 && (
                    <details className="metadata-disclosure">
                      <summary>View extracted metadata</summary>
                      <dl>
                        {Object.entries(document.extracted_metadata).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt>{key.replaceAll("_", " ")}</dt>
                              <dd>{formatValue(value)}</dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </details>
                  )}
                  <time dateTime={document.created_at}>
                    Indexed {new Date(document.created_at).toLocaleString()}
                  </time>
                </article>
              ))}
            </div>
          ) : (
            !dashboard.isPending && (
              <EmptyState
                title="No authorized documents yet"
                description="Ask an organization administrator to upload and release a document with access for your role."
              />
            )
          )}
        </section>
      </main>
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="dashboard-summary-card">
      <small>{label}</small>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}
