import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DashboardDocument } from "../../api/types";
import { AppShell } from "../../components/layout/AppShell";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  StatusMessage,
} from "../../components/ui";
import { listDocumentSchemas, schemaKeys } from "../documents/api";
import { dashboardKeys, getDashboard, searchDashboardDocuments } from "./api";

function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value) ?? "—";
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "—";
}

function formatFieldName(field: string) {
  return field.replaceAll("_", " ");
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
  const [documentQuery, setDocumentQuery] = useState("");
  const [debouncedDocumentQuery, setDebouncedDocumentQuery] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedDocumentQuery(documentQuery.trim()),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [documentQuery]);
  const documents = useQuery({
    queryKey: dashboardKeys.documents(debouncedDocumentQuery),
    queryFn: () => searchDashboardDocuments(debouncedDocumentQuery),
  });
  const documentGroups = useMemo(() => {
    const schemasByDocumentType = new Map(
      (schemas.data ?? []).flatMap((industry) =>
        industry.document_types.map(
          (document) =>
            [
              document.key,
              {
                fields: document.fields,
                industryLabel: industry.label,
                documentTypeLabel: document.label,
              },
            ] as const,
        ),
      ),
    );
    const documentsByType = new Map<string, DashboardDocument[]>();
    for (const document of documents.data?.documents ?? []) {
      const key = document.document_type ?? "unclassified";
      const group = documentsByType.get(key) ?? [];
      group.push(document);
      documentsByType.set(key, group);
    }

    return Array.from(documentsByType, ([key, groupedDocuments]) => {
      const schema = schemasByDocumentType.get(key);
      const schemaFields = schema?.fields ?? [];
      const extraFields = Array.from(
        new Set(
          groupedDocuments.flatMap((document) =>
            Object.keys(document.extracted_metadata),
          ),
        ),
      )
        .filter((field) => !schemaFields.includes(field))
        .sort((left, right) =>
          formatFieldName(left).localeCompare(formatFieldName(right)),
        );
      const firstDocument = groupedDocuments[0]!;
      return {
        key,
        documents: groupedDocuments,
        fields: [...schemaFields, ...extraFields],
        industryLabel: schema?.industryLabel ?? firstDocument.industry_label,
        documentTypeLabel:
          schema?.documentTypeLabel ?? firstDocument.document_type_label,
      };
    }).sort(
      (left, right) =>
        left.industryLabel.localeCompare(right.industryLabel) ||
        left.documentTypeLabel.localeCompare(right.documentTypeLabel),
    );
  }, [documents.data?.documents, schemas.data]);
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
            label="Needs type review"
            value={dashboard.data?.review_required_documents}
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

        <section aria-labelledby="dashboard-documents-title">
          <div className="dashboard-section-heading">
            <div>
              <span className="section-kicker">Extracted data</span>
              <h2 id="dashboard-documents-title">Document data</h2>
            </div>
            <p>
              {documents.data
                ? `${documents.data.total} authorized ${documents.data.total === 1 ? "document" : "documents"}`
                : "Only documents permitted for your role or user are shown."}
            </p>
          </div>
          <div className="dashboard-document-search">
            <Input
              type="search"
              aria-label="Search dashboard documents"
              placeholder="Search by filename, document type, or industry"
              value={documentQuery}
              onChange={(event) => setDocumentQuery(event.target.value)}
            />
          </div>
          {documents.isPending && (
            <StatusMessage>Loading authorized documents…</StatusMessage>
          )}
          {documents.error instanceof Error && (
            <StatusMessage>{documents.error.message}</StatusMessage>
          )}
          {documents.data?.documents.length ? (
            <div className="dashboard-document-groups">
              {documentGroups.map(({ key, ...group }) => (
                <DocumentTypeTable key={key} {...group} />
              ))}
            </div>
          ) : (
            !documents.isPending &&
            !documents.error && (
              <EmptyState
                title={
                  debouncedDocumentQuery
                    ? "No matching documents"
                    : "No authorized documents yet"
                }
                description={
                  debouncedDocumentQuery
                    ? "Try another filename, document type, or industry."
                    : "Ask an organization administrator to upload and release a document with access for your role."
                }
              />
            )
          )}
        </section>
      </main>
    </AppShell>
  );
}

function DocumentTypeTable({
  documents,
  fields,
  industryLabel,
  documentTypeLabel,
}: {
  documents: DashboardDocument[];
  fields: string[];
  industryLabel: string;
  documentTypeLabel: string;
}) {
  return (
    <section className="dashboard-document-group">
      <header className="dashboard-document-group-header">
        <div>
          <span>{industryLabel}</span>
          <h3>{documentTypeLabel}</h3>
        </div>
        <Badge variant="metric">
          {documents.length} {documents.length === 1 ? "document" : "documents"}
        </Badge>
      </header>
      <div
        className="dashboard-document-list"
        role="region"
        aria-label={`${documentTypeLabel} extracted data table`}
        tabIndex={0}
      >
        <table
          className="dashboard-document-table"
          style={{ width: `${680 + fields.length * 220}px` }}
        >
          <caption className="sr-only">
            Extracted data for authorized {documentTypeLabel} documents
          </caption>
          <thead>
            <tr>
              <th className="document-identity-column" scope="col">
                Document
              </th>
              <th className="document-classification-column" scope="col">
                Classification
              </th>
              <th className="document-extraction-column" scope="col">
                Extraction
              </th>
              {fields.map((field) => (
                <th
                  className="document-extracted-field-column"
                  scope="col"
                  key={field}
                >
                  {formatFieldName(field)}
                </th>
              ))}
              <th className="document-indexed-column" scope="col">
                Indexed
              </th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.document_id}>
                <th scope="row" className="document-identity-cell">
                  <strong>{document.document_name}</strong>
                </th>
                <td className="document-classification-cell">
                  <Badge
                    variant={
                      document.classification_status === "confirmed"
                        ? "active"
                        : "suspended"
                    }
                  >
                    {document.classification_status === "review_required"
                      ? "Review type"
                      : document.classification_status === "failed"
                        ? "Detection failed"
                        : document.classification_status === "unclassified"
                          ? "Unclassified"
                          : document.classification_source === "manual"
                            ? "Manual type"
                            : "Auto-detected"}
                  </Badge>
                  {typeof document.classification_confidence === "number" && (
                    <small>
                      Detection confidence:{" "}
                      {Math.round(document.classification_confidence * 100)}%
                    </small>
                  )}
                </td>
                <td>
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
                </td>
                {fields.map((field) => (
                  <td className="document-extracted-value-cell" key={field}>
                    <ExtractedFieldValue
                      documentName={document.document_name}
                      field={field}
                      value={document.extracted_metadata[field]}
                    />
                  </td>
                ))}
                <td className="document-indexed-cell">
                  <time dateTime={document.created_at}>
                    {new Date(document.created_at).toLocaleString()}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExtractedFieldValue({
  documentName,
  field,
  value,
}: {
  documentName: string;
  field: string;
  value: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const formattedValue = formatValue(value);
  const isLong =
    formattedValue.length > 80 || formattedValue.split(/\r?\n/).length > 3;

  return (
    <div className={`document-cell-value ${expanded ? "expanded" : ""}`}>
      <span className="document-cell-value-text">{formattedValue}</span>
      {isLong && (
        <Button
          variant="text"
          className="document-cell-toggle"
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Show all"} ${formatFieldName(field)} for ${documentName}`}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
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
