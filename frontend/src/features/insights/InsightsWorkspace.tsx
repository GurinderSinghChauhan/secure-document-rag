import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { DashboardDocument } from "../../api/types";
import { AppShell } from "../../components/layout/AppShell";
import { Badge, EmptyState, StatusMessage } from "../../components/ui";
import { dashboardKeys, searchDashboardDocuments } from "../dashboard/api";
import { listDocumentSchemas, schemaKeys } from "../documents/api";

type ChartDatum = { label: string; value: number };

const CATEGORY_FIELDS =
  /(status|category|type|department|priority|severity|provider|manufacturer|payment|pass_fail|modality|condition|rating|cause|frequency)/i;
const ENTITY_FIELDS =
  /(vendor|customer|technician|provider|manufacturer|contractor|employee|borrower|property|machine|insurer|court|judge|department|laboratory)/i;
const NUMERIC_FIELDS =
  /(amount|cost|total|value|balance|price|premium|score|hours|quantity|days|rent|income|wages|tax|deductible|payment|deposit|retainage|downtime|square_feet|bedrooms|bathrooms|refills)/i;
const DATE_FIELDS =
  /(date|start|end|due|expiration|renewal|period|hearing|follow_up)/i;
const DEADLINE_FIELDS =
  /(due|end|expiration|renewal|deadline|next_service|follow_up|hearing|valid_until|completion_date)/i;

function fieldLabel(field: string) {
  return field.replaceAll("_", " ");
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (typeof value === "object") {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : "";
  }
  return "";
}

function valuesForField(documents: DashboardDocument[], field: string) {
  return documents
    .flatMap((document) => {
      const value = document.extracted_metadata[field];
      return Array.isArray(value) ? (value as unknown[]) : [value];
    })
    .map(displayValue)
    .filter(Boolean);
}

function countValues(values: string[], limit = 8): ChartDatum[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts, ([label, value]) => ({ label, value }))
    .sort(
      (left, right) =>
        right.value - left.value || left.label.localeCompare(right.label),
    )
    .slice(0, limit);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[$,%\s]/g, "").replaceAll(",", "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function buildInsights(documents: DashboardDocument[], fields: string[]) {
  const completeness = fields.map((field) => {
    const populated = documents.filter((document) =>
      Boolean(displayValue(document.extracted_metadata[field])),
    ).length;
    return {
      label: fieldLabel(field),
      value: documents.length
        ? Math.round((populated / documents.length) * 100)
        : 0,
    };
  });
  const populatedCells = completeness.reduce(
    (sum, item) => sum + item.value,
    0,
  );
  const completenessAverage = completeness.length
    ? Math.round(populatedCells / completeness.length)
    : 0;

  const categoryField = fields
    .map((field) => ({ field, values: valuesForField(documents, field) }))
    .filter(
      ({ field, values }) =>
        CATEGORY_FIELDS.test(field) &&
        values.length > 0 &&
        new Set(values).size <= 12 &&
        values.reduce((sum, value) => sum + value.length, 0) / values.length <=
          60,
    )
    .sort(
      (left, right) => new Set(left.values).size - new Set(right.values).size,
    )[0];
  const categories = categoryField
    ? countValues(categoryField.values)
    : countValues(documents.map((document) => document.extraction_status));

  const entityField = fields.find(
    (field) =>
      ENTITY_FIELDS.test(field) && valuesForField(documents, field).length,
  );
  const entities = entityField
    ? countValues(valuesForField(documents, entityField))
    : [];

  const numericField = fields.find(
    (field) =>
      NUMERIC_FIELDS.test(field) &&
      documents.some(
        (document) => parseNumber(document.extracted_metadata[field]) !== null,
      ),
  );
  const allNumericValues = numericField
    ? documents
        .map((document) => ({
          label: document.document_name,
          value: parseNumber(document.extracted_metadata[numericField]),
        }))
        .filter((item): item is ChartDatum => item.value !== null)
    : [];
  const numericValues = numericField
    ? [...allNumericValues]
        .sort((left, right) => right.value - left.value)
        .slice(0, 8)
    : documents
        .filter(
          (document) => typeof document.classification_confidence === "number",
        )
        .map((document) => ({
          label: document.document_name,
          value: Math.round((document.classification_confidence ?? 0) * 100),
        }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 8);

  const dateField = fields.find(
    (field) =>
      DATE_FIELDS.test(field) &&
      documents.some(
        (document) => parseDate(document.extracted_metadata[field]) !== null,
      ),
  );
  const dates = documents
    .map((document) =>
      dateField
        ? parseDate(document.extracted_metadata[dateField])
        : parseDate(document.created_at),
    )
    .filter((date): date is Date => date !== null);
  const monthlyCounts = new Map<string, { date: Date; value: number }>();
  for (const date of dates) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const existing = monthlyCounts.get(key);
    monthlyCounts.set(key, { date, value: (existing?.value ?? 0) + 1 });
  }
  const trend = Array.from(monthlyCounts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, item]) => ({
      label: item.date.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      }),
      value: item.value,
    }));

  const deadlines = documents
    .flatMap((document) =>
      fields
        .filter((field) => DEADLINE_FIELDS.test(field))
        .map((field) => ({
          document: document.document_name,
          field: fieldLabel(field),
          date: parseDate(document.extracted_metadata[field]),
        })),
    )
    .filter(
      (item): item is { document: string; field: string; date: Date } =>
        item.date !== null,
    )
    .sort((left, right) => left.date.getTime() - right.date.getTime())
    .slice(0, 8);

  const numericTotal = allNumericValues.reduce(
    (sum, item) => sum + item.value,
    0,
  );
  const documentDates = documents
    .map((document) => new Date(document.created_at))
    .sort((left, right) => left.getTime() - right.getTime());

  return {
    completeness,
    completenessAverage,
    categories,
    categoryTitle: categoryField
      ? `${fieldLabel(categoryField.field)} breakdown`
      : "Extraction status",
    entities,
    entityTitle: entityField
      ? `Top ${fieldLabel(entityField)}`
      : "Top entities",
    numericValues,
    numericTitle: numericField
      ? `${fieldLabel(numericField)} by document`
      : "Classification confidence",
    numericTotal,
    numericField,
    trend,
    trendTitle: dateField
      ? `${fieldLabel(dateField)} volume over time`
      : "Documents indexed over time",
    deadlines,
    dateRange:
      documentDates.length > 0
        ? `${documentDates[0]!.toLocaleDateString()} – ${documentDates.at(-1)!.toLocaleDateString()}`
        : "No dates",
  };
}

export function InsightsWorkspace() {
  const { documentType } = useParams();
  const schemas = useQuery({
    queryKey: schemaKeys.all,
    queryFn: listDocumentSchemas,
  });
  const documents = useQuery({
    queryKey: dashboardKeys.documents(documentType ?? ""),
    queryFn: () => searchDashboardDocuments(documentType ?? ""),
    enabled: Boolean(documentType),
  });
  let schemaMatch: {
    industry: NonNullable<typeof schemas.data>[number];
    type: NonNullable<typeof schemas.data>[number]["document_types"][number];
  } | null = null;
  for (const industry of schemas.data ?? []) {
    const type = industry.document_types.find(
      (item) => item.key === documentType,
    );
    if (type) {
      schemaMatch = { industry, type };
      break;
    }
  }
  const authorizedDocuments = (documents.data?.documents ?? []).filter(
    (document) => document.document_type === documentType,
  );
  const fields = Array.from(
    new Set([
      ...(schemaMatch?.type.fields ?? []),
      ...authorizedDocuments.flatMap((document) =>
        Object.keys(document.extracted_metadata),
      ),
    ]),
  );
  const insights = buildInsights(authorizedDocuments, fields);

  const pending = schemas.isPending || documents.isPending;
  const error = schemas.error ?? documents.error;

  return (
    <AppShell section="Insights">
      <main className="insights-content">
        <Link className="insights-back-link" to="/">
          ← Back to document tables
        </Link>
        {pending ? (
          <StatusMessage>Building authorized document insights…</StatusMessage>
        ) : error instanceof Error ? (
          <StatusMessage>{error.message}</StatusMessage>
        ) : !schemaMatch ? (
          <EmptyState
            title="Unknown document type"
            description="Return to the dashboard and choose Insights from a supported document table."
          />
        ) : authorizedDocuments.length === 0 ? (
          <EmptyState
            title={`No authorized ${schemaMatch.type.label} documents`}
            description="Insights appear after documents of this type are extracted and made available to your role or user."
          />
        ) : (
          <>
            <header className="insights-header">
              <div>
                <span className="section-kicker">
                  {schemaMatch.industry.label}
                </span>
                <h1>{schemaMatch.type.label} insights</h1>
                <p>
                  Deterministic diagrams calculated from the currently
                  authorized extracted fields. No source content is sent to
                  another service.
                </p>
              </div>
              <Badge variant="metric">Up to 100 authorized results</Badge>
            </header>

            <section className="insights-kpis" aria-label="Insight summary">
              <InsightKpi
                label="Documents"
                value={String(authorizedDocuments.length)}
              />
              <InsightKpi
                label="Extracted"
                value={`${Math.round((authorizedDocuments.filter((document) => document.extraction_status === "completed").length / authorizedDocuments.length) * 100)}%`}
              />
              <InsightKpi
                label="Field completeness"
                value={`${insights.completenessAverage}%`}
              />
              <InsightKpi
                label="Indexed range"
                value={insights.dateRange}
                compact
              />
              {insights.numericField && (
                <InsightKpi
                  label={`Total ${fieldLabel(insights.numericField)}`}
                  value={compactNumber(insights.numericTotal)}
                />
              )}
            </section>

            <section className="insights-grid" aria-label="Insight diagrams">
              <InsightPanel
                title={insights.trendTitle}
                subtitle="Document volume by month"
                wide
              >
                <LineChart data={insights.trend} />
              </InsightPanel>
              <InsightPanel
                title={insights.categoryTitle}
                subtitle="Most common extracted values"
              >
                <BarChart data={insights.categories} />
              </InsightPanel>
              <InsightPanel
                title={insights.numericTitle}
                subtitle="Largest values in the authorized set"
              >
                <BarChart
                  data={insights.numericValues}
                  valueFormatter={compactNumber}
                />
              </InsightPanel>
              {insights.entities.length > 0 && (
                <InsightPanel
                  title={insights.entityTitle}
                  subtitle="Most frequently referenced entities"
                >
                  <BarChart data={insights.entities} />
                </InsightPanel>
              )}
              {insights.deadlines.length > 0 && (
                <InsightPanel
                  title="Deadline timeline"
                  subtitle="Extracted due, renewal, expiration, and follow-up dates"
                  wide
                >
                  <DeadlineTimeline items={insights.deadlines} />
                </InsightPanel>
              )}
              <InsightPanel
                title="Extracted-field completeness"
                subtitle="Percentage of documents with a populated value"
                wide
              >
                <CompletenessChart data={insights.completeness} />
              </InsightPanel>
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}

function InsightKpi({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={`insight-kpi ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InsightPanel({
  title,
  subtitle,
  wide = false,
  children,
}: {
  title: string;
  subtitle: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <article className={`insight-panel ${wide ? "wide" : ""}`}>
      <header>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {children}
    </article>
  );
}

function BarChart({
  data,
  valueFormatter = compactNumber,
}: {
  data: ChartDatum[];
  valueFormatter?: (value: number) => string;
}) {
  const maximum = Math.max(...data.map((item) => item.value), 1);
  if (!data.length)
    return (
      <p className="insight-no-data">
        Not enough populated values for this diagram.
      </p>
    );
  return (
    <div className="insight-bars">
      {data.map((item) => (
        <div className="insight-bar-row" key={item.label}>
          <span title={item.label}>{item.label}</span>
          <div aria-hidden="true">
            <i
              style={{ width: `${Math.max((item.value / maximum) * 100, 3)}%` }}
            />
          </div>
          <strong>{valueFormatter(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function LineChart({ data }: { data: ChartDatum[] }) {
  if (!data.length)
    return <p className="insight-no-data">No usable dates were extracted.</p>;
  const width = 720;
  const height = 220;
  const inset = 28;
  const maximum = Math.max(...data.map((item) => item.value), 1);
  const points = data.map((item, index) => ({
    ...item,
    x:
      data.length === 1
        ? width / 2
        : inset + (index / (data.length - 1)) * (width - inset * 2),
    y: height - inset - (item.value / maximum) * (height - inset * 2),
  }));
  return (
    <div className="insight-line-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Document volume trend"
      >
        <line
          x1={inset}
          y1={height - inset}
          x2={width - inset}
          y2={height - inset}
        />
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
        />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="5" />
            <text x={point.x} y={point.y - 12} textAnchor="middle">
              {point.value}
            </text>
          </g>
        ))}
      </svg>
      <div className="insight-line-labels">
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

function CompletenessChart({ data }: { data: ChartDatum[] }) {
  return (
    <div className="insight-completeness">
      {data.map((item) => (
        <div key={item.label}>
          <span title={item.label}>{item.label}</span>
          <progress
            max="100"
            value={item.value}
            aria-label={`${item.label} ${item.value}% complete`}
          />
          <strong>{item.value}%</strong>
        </div>
      ))}
    </div>
  );
}

function DeadlineTimeline({
  items,
}: {
  items: Array<{ document: string; field: string; date: Date }>;
}) {
  return (
    <ol className="insight-timeline">
      {items.map((item) => (
        <li key={`${item.document}-${item.field}-${item.date.toISOString()}`}>
          <time dateTime={item.date.toISOString()}>
            {item.date.toLocaleDateString()}
          </time>
          <div>
            <strong>{item.field}</strong>
            <span>{item.document}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
