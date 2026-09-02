import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { DashboardDocument } from "../../api/types";
import { AppShell } from "../../components/layout/AppShell";
import { EmptyState, StatusMessage } from "../../components/ui";
import { dashboardKeys, searchDashboardDocuments } from "../dashboard/api";
import { listDocumentSchemas, schemaKeys } from "../documents/api";

type ChartDatum = { label: string; value: number };

const CHART_COLORS = [
  "#3157d5",
  "#16a37a",
  "#8b5cf6",
  "#e59b2f",
  "#e15d74",
  "#3f8fc7",
  "#7c8b55",
  "#a86d3d",
];

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
  const extractedPercentage = Math.round(
    (authorizedDocuments.filter(
      (document) => document.extraction_status === "completed",
    ).length /
      Math.max(authorizedDocuments.length, 1)) *
      100,
  );
  const leadingCategory = insights.categories[0];
  const nearestDeadline = insights.deadlines[0];
  const lowCompletenessFields = insights.completeness.filter(
    (item) => item.value < 75,
  ).length;

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
            <header className="insights-hero">
              <div className="insights-hero-copy">
                <span className="insights-eyebrow">
                  <i aria-hidden="true" />
                  {schemaMatch.industry.label}
                </span>
                <h1>{schemaMatch.type.label} insights</h1>
                <p>
                  Turn your authorized document data into a clear view of
                  volume, value, deadlines, and data quality.
                </p>
                <div className="insights-trust-note">
                  <span aria-hidden="true">&#10003;</span>
                  Calculated privately from extracted fields—no source content
                  leaves your environment.
                </div>
              </div>
              <div
                className="insights-hero-stat"
                aria-label="Insight coverage"
                role="region"
              >
                <span>Insight coverage</span>
                <strong>{insights.completenessAverage}%</strong>
                <div aria-hidden="true">
                  <i style={{ width: `${insights.completenessAverage}%` }} />
                </div>
                <small>across {fields.length} extracted fields</small>
              </div>
            </header>

            <section className="insights-signal-strip" aria-label="Quick read">
              <div>
                <span
                  className="insight-signal-icon positive"
                  aria-hidden="true"
                >
                  ↗
                </span>
                <p>
                  <small>Leading signal</small>
                  <strong>
                    {leadingCategory
                      ? `${leadingCategory.label} leads with ${leadingCategory.value}`
                      : "No category signal yet"}
                  </strong>
                </p>
              </div>
              <div>
                <span className="insight-signal-icon" aria-hidden="true">
                  ◫
                </span>
                <p>
                  <small>Data readiness</small>
                  <strong>
                    {lowCompletenessFields
                      ? `${lowCompletenessFields} fields need attention`
                      : "All fields are well populated"}
                  </strong>
                </p>
              </div>
              <div>
                <span
                  className="insight-signal-icon warning"
                  aria-hidden="true"
                >
                  ◷
                </span>
                <p>
                  <small>Nearest milestone</small>
                  <strong>
                    {nearestDeadline
                      ? `${nearestDeadline.field} · ${nearestDeadline.date.toLocaleDateString()}`
                      : "No extracted deadlines"}
                  </strong>
                </p>
              </div>
            </section>

            <section className="insights-kpis" aria-label="Insight summary">
              <InsightKpi
                label="Documents"
                value={String(authorizedDocuments.length)}
                detail="authorized records"
                tone="blue"
              />
              <InsightKpi
                label="Extracted"
                value={`${extractedPercentage}%`}
                detail="success rate"
                tone="green"
              />
              <InsightKpi
                label="Field completeness"
                value={`${insights.completenessAverage}%`}
                detail={`${fields.length} fields measured`}
                tone="violet"
              />
              <InsightKpi
                label="Indexed range"
                value={insights.dateRange}
                detail="authorized window"
                compact
                tone="amber"
              />
              {insights.numericField && (
                <InsightKpi
                  label={`Total ${fieldLabel(insights.numericField)}`}
                  value={compactNumber(insights.numericTotal)}
                  detail="across visible records"
                  tone="rose"
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
                <DonutChart data={insights.categories} />
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
  detail,
  compact = false,
  tone = "blue",
}: {
  label: string;
  value: string;
  detail: string;
  compact?: boolean;
  tone?: "blue" | "green" | "violet" | "amber" | "rose";
}) {
  return (
    <div className={`insight-kpi ${tone} ${compact ? "compact" : ""}`}>
      <i aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
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
      {data.map((item, index) => (
        <div className="insight-bar-row" key={item.label}>
          <span title={item.label}>{item.label}</span>
          <div aria-hidden="true">
            <i
              style={{
                width: `${Math.max((item.value / maximum) * 100, 3)}%`,
                background: CHART_COLORS[index % CHART_COLORS.length],
              }}
            />
          </div>
          <strong>{valueFormatter(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ data }: { data: ChartDatum[] }) {
  if (!data.length)
    return (
      <p className="insight-no-data">
        Not enough populated values for this diagram.
      </p>
    );
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="insight-donut-layout">
      <div className="insight-donut">
        <svg viewBox="0 0 120 120" role="img" aria-label="Value distribution">
          <circle className="insight-donut-track" cx="60" cy="60" r={radius} />
          {data.map((item, index) => {
            const length = (item.value / total) * circumference;
            const segmentOffset =
              (data
                .slice(0, index)
                .reduce((sum, segment) => sum + segment.value, 0) /
                total) *
              circumference;
            return (
              <circle
                className="insight-donut-segment"
                cx="60"
                cy="60"
                r={radius}
                key={item.label}
                stroke={CHART_COLORS[index % CHART_COLORS.length]}
                strokeDasharray={`${Math.max(length - 2, 0)} ${circumference}`}
                strokeDashoffset={-segmentOffset}
              >
                <title>{`${item.label}: ${item.value}`}</title>
              </circle>
            );
          })}
        </svg>
        <span>
          <strong>{compactNumber(total)}</strong>
          <small>Total</small>
        </span>
      </div>
      <div className="insight-donut-legend">
        {data.map((item, index) => (
          <div key={item.label}>
            <i
              aria-hidden="true"
              style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
            />
            <span title={item.label}>{item.label}</span>
            <strong>{Math.round((item.value / total) * 100)}%</strong>
          </div>
        ))}
      </div>
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
        <defs>
          <linearGradient id="insight-line-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((position) => (
          <line
            className="insight-grid-line"
            x1={inset}
            y1={inset + position * (height - inset * 2)}
            x2={width - inset}
            y2={inset + position * (height - inset * 2)}
            key={position}
          />
        ))}
        <line
          x1={inset}
          y1={height - inset}
          x2={width - inset}
          y2={height - inset}
        />
        {points.length > 1 && (
          <polygon
            className="insight-line-area"
            points={`${points.map((point) => `${point.x},${point.y}`).join(" ")} ${points.at(-1)!.x},${height - inset} ${points[0]!.x},${height - inset}`}
          />
        )}
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
