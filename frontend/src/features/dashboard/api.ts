import { api } from "../../api/client";
import type { Dashboard, DashboardDocumentList } from "../../api/types";

export const dashboardKeys = {
  overview: ["dashboard"] as const,
  documents: (query: string) => ["dashboard", "documents", query] as const,
};

export const getDashboard = () =>
  api.json<Dashboard>(
    "/v1/dashboard",
    {},
    "Unable to load the document dashboard.",
  );

export async function searchDashboardDocuments(query: string) {
  const pageSize = 100;
  const documents: DashboardDocumentList["documents"] = [];
  let total = 0;
  for (let offset = 0; ; offset += pageSize) {
    const parameters = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    });
    if (query) parameters.set("query", query);
    const page = await api.json<DashboardDocumentList>(
      `/v1/dashboard/documents?${parameters.toString()}`,
      {},
      "Unable to load dashboard documents.",
    );
    total = page.total;
    documents.push(...page.documents);
    if (documents.length >= total || page.documents.length < pageSize) {
      return { total, documents };
    }
  }
}
