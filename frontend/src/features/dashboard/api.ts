import { api } from "../../api/client";
import type { Dashboard } from "../../api/types";

export const dashboardKeys = { overview: ["dashboard"] as const };

export const getDashboard = () =>
  api.json<Dashboard>(
    "/v1/dashboard",
    {},
    "Unable to load the document dashboard.",
  );
