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

export const searchDashboardDocuments = (query: string) => {
  const parameters = new URLSearchParams({ limit: "100" });
  if (query) parameters.set("query", query);
  return api.json<DashboardDocumentList>(
    `/v1/dashboard/documents?${parameters.toString()}`,
    {},
    "Unable to load dashboard documents.",
  );
};
