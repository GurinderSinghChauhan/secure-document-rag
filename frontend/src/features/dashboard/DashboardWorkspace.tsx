import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
                industryKey: industry.key,
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
        industryKey:
          schema?.industryKey ?? firstDocument.industry_key ?? "unclassified",
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
  const documentVerticalGroups = useMemo(() => {
    const verticals = new Map<
      string,
      {
        key: string;
        label: string;
        documentTypes: typeof documentGroups;
      }
    >();
    for (const documentGroup of documentGroups) {
      const vertical = verticals.get(documentGroup.industryKey) ?? {
        key: documentGroup.industryKey,
        label: documentGroup.industryLabel,
        documentTypes: [],
      };
      vertical.documentTypes.push(documentGroup);
      verticals.set(documentGroup.industryKey, vertical);
    }
    return Array.from(verticals.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    );
  }, [documentGroups]);
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
            <div className="dashboard-document-verticals">
              {documentVerticalGroups.map((vertical) => (
                <section
                  className="dashboard-document-vertical"
                  aria-label={`${vertical.label} document tables`}
                  key={vertical.key}
                >
                  <header className="dashboard-document-vertical-header">
                    <div>
                      <span className="section-kicker">Vertical</span>
                      <h3>{vertical.label}</h3>
                    </div>
                    <Badge variant="metric">
                      {vertical.documentTypes.length}{" "}
                      {vertical.documentTypes.length === 1 ? "type" : "types"}
                    </Badge>
                  </header>
                  <div className="dashboard-document-card-grid">
                    {vertical.documentTypes.map(({ key, ...group }) => (
                      <DocumentTypeTableCard
                        key={key}
                        documentTypeKey={key}
                        {...group}
                      />
                    ))}
                  </div>
                </section>
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

function DocumentTypeTableCard({
  documentTypeKey,
  documents,
  fields,
  industryLabel,
  documentTypeLabel,
}: {
  documentTypeKey: string;
  documents: DashboardDocument[];
  fields: string[];
  industryLabel: string;
  documentTypeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const closeDialog = useCallback(() => setOpen(false), []);

  return (
    <article className="dashboard-document-card">
      <div>
        <h4>{documentTypeLabel}</h4>
        <p>
          {documents.length} {documents.length === 1 ? "document" : "documents"}{" "}
          · {fields.length} extracted {fields.length === 1 ? "field" : "fields"}
        </p>
      </div>
      <Button
        variant="secondary"
        aria-haspopup="dialog"
        aria-label={`View ${industryLabel} ${documentTypeLabel} table`}
        onClick={() => setOpen(true)}
      >
        View table
      </Button>
      {open && (
        <DocumentTableDialog
          documentTypeKey={documentTypeKey}
          documents={documents}
          fields={fields}
          industryLabel={industryLabel}
          documentTypeLabel={documentTypeLabel}
          onClose={closeDialog}
        />
      )}
    </article>
  );
}

function DocumentTableDialog({
  documentTypeKey,
  documents,
  fields,
  industryLabel,
  documentTypeLabel,
  onClose,
}: {
  documentTypeKey: string;
  documents: DashboardDocument[];
  fields: string[];
  industryLabel: string;
  documentTypeLabel: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => !element.hasAttribute("disabled"));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="dashboard-table-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="dashboard-table-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dashboard-table-dialog-header">
          <div>
            <span>{industryLabel}</span>
            <h3 id={titleId}>{documentTypeLabel}</h3>
            <p>
              {documents.length}{" "}
              {documents.length === 1
                ? "authorized document"
                : "authorized documents"}
            </p>
          </div>
          <div className="dashboard-table-dialog-actions">
            <Link
              className="secondary-button"
              to={`/insights/${encodeURIComponent(documentTypeKey)}`}
            >
              Insights
            </Link>
            <Button
              ref={closeButton}
              variant="secondary"
              aria-label={`Close ${documentTypeLabel} table`}
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </header>
        <DocumentDataTable
          documents={documents}
          fields={fields}
          documentTypeLabel={documentTypeLabel}
        />
      </section>
    </div>
  );
}

function DocumentDataTable({
  documents,
  fields,
  documentTypeLabel,
}: {
  documents: DashboardDocument[];
  fields: string[];
  documentTypeLabel: string;
}) {
  const [sort, setSort] = useState<{
    column: string;
    direction: "ascending" | "descending";
  } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const collator = useMemo(
    () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
    [],
  );
  const columnValue = useCallback(
    (document: DashboardDocument, column: string) => {
      if (column === "document") return document.document_name;
      if (column === "indexed") return document.created_at;
      return formatValue(document.extracted_metadata[column.slice(6)]);
    },
    [],
  );
  const visibleDocuments = useMemo(() => {
    const filtered = documents.filter((document) =>
      Object.entries(filters).every(([column, query]) =>
        columnValue(document, column)
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    );
    if (!sort) return filtered;
    return [...filtered].sort((left, right) => {
      const result = collator.compare(
        columnValue(left, sort.column),
        columnValue(right, sort.column),
      );
      return sort.direction === "ascending" ? result : -result;
    });
  }, [collator, columnValue, documents, filters, sort]);
  const updateFilter = (column: string, value: string) => {
    setFilters((current) => {
      const next = { ...current };
      if (value) next[column] = value;
      else delete next[column];
      return next;
    });
  };
  const toggleSort = (column: string) => {
    setSort((current) => ({
      column,
      direction:
        current?.column === column && current.direction === "ascending"
          ? "descending"
          : "ascending",
    }));
  };

  return (
    <div className="dashboard-table-explorer">
      <div className="dashboard-table-toolbar">
        <p role="status">
          Showing {visibleDocuments.length} of {documents.length}{" "}
          {documents.length === 1 ? "row" : "rows"}
        </p>
        <Button
          variant="text"
          disabled={!sort && Object.keys(filters).length === 0}
          onClick={() => {
            setSort(null);
            setFilters({});
          }}
        >
          Reset table view
        </Button>
      </div>
      <div
        className="dashboard-document-list"
        role="region"
        aria-label={`${documentTypeLabel} extracted data table`}
        tabIndex={0}
      >
        <table
          className="dashboard-document-table"
          style={{ width: `${395 + fields.length * 220}px` }}
        >
          <caption className="sr-only">
            Extracted data for authorized {documentTypeLabel} documents
          </caption>
          <thead>
            <tr>
              <SortableColumnHeader
                column="document"
                label="Document"
                className="document-identity-column"
                sort={sort}
                filter={filters.document ?? ""}
                onSort={toggleSort}
                onFilter={updateFilter}
              />
              {fields.map((field) => (
                <SortableColumnHeader
                  column={`field:${field}`}
                  label={formatFieldName(field)}
                  className="document-extracted-field-column"
                  sort={sort}
                  filter={filters[`field:${field}`] ?? ""}
                  onSort={toggleSort}
                  onFilter={updateFilter}
                  key={field}
                />
              ))}
              <SortableColumnHeader
                column="indexed"
                label="Indexed"
                className="document-indexed-column"
                sort={sort}
                filter={filters.indexed ?? ""}
                onSort={toggleSort}
                onFilter={updateFilter}
              />
            </tr>
          </thead>
          <tbody>
            {visibleDocuments.length ? (
              visibleDocuments.map((document) => (
                <tr key={document.document_id}>
                  <th scope="row" className="document-identity-cell">
                    <strong>{document.document_name}</strong>
                  </th>
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
              ))
            ) : (
              <tr>
                <td
                  className="dashboard-table-no-results"
                  colSpan={fields.length + 2}
                >
                  No rows match the current column filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableColumnHeader({
  column,
  label,
  className,
  sort,
  filter,
  onSort,
  onFilter,
}: {
  column: string;
  label: string;
  className: string;
  sort: { column: string; direction: "ascending" | "descending" } | null;
  filter: string;
  onSort: (column: string) => void;
  onFilter: (column: string, value: string) => void;
}) {
  const activeDirection = sort?.column === column ? sort.direction : null;
  const nextDirection =
    activeDirection === "ascending" ? "descending" : "ascending";

  return (
    <th className={className} scope="col" aria-sort={activeDirection ?? "none"}>
      <Button
        variant="unstyled"
        className="dashboard-column-sort"
        aria-label={`Sort by ${label} ${nextDirection}`}
        onClick={() => onSort(column)}
      >
        <span>{label}</span>
        <span aria-hidden="true">
          {activeDirection === "ascending"
            ? "↑"
            : activeDirection === "descending"
              ? "↓"
              : "↕"}
        </span>
      </Button>
      <input
        className="dashboard-column-filter"
        type="search"
        aria-label={`Filter ${label}`}
        placeholder="Filter…"
        value={filter}
        onChange={(event) => onFilter(column, event.target.value)}
      />
    </th>
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
  const [overflowing, setOverflowing] = useState(false);
  const valueRef = useRef<HTMLSpanElement>(null);
  const formattedValue = formatValue(value);
  useLayoutEffect(() => {
    if (expanded) return;
    const element = valueRef.current;
    if (!element) return;
    const measure = () =>
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, formattedValue]);

  return (
    <div className={`document-cell-value ${expanded ? "expanded" : ""}`}>
      <span ref={valueRef} className="document-cell-value-text">
        {formattedValue}
      </span>
      {overflowing && (
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
