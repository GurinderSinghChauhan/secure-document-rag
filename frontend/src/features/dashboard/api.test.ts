import { vi } from "vitest";
import { api } from "../../api/client";
import type { DashboardDocument } from "../../api/types";
import { searchDashboardDocuments } from "./api";

function document(index: number): DashboardDocument {
  return { document_id: `document-${index}` } as DashboardDocument;
}

test("loads every dashboard document page beyond the first 100 records", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => document(index));
  const secondPage = [document(100)];
  const request = vi
    .spyOn(api, "json")
    .mockResolvedValueOnce({ total: 101, documents: firstPage })
    .mockResolvedValueOnce({ total: 101, documents: secondPage });

  const result = await searchDashboardDocuments("");

  expect(result.total).toBe(101);
  expect(result.documents).toHaveLength(101);
  expect(request).toHaveBeenNthCalledWith(
    1,
    "/v1/dashboard/documents?limit=100&offset=0",
    {},
    "Unable to load dashboard documents.",
  );
  expect(request).toHaveBeenNthCalledWith(
    2,
    "/v1/dashboard/documents?limit=100&offset=100",
    {},
    "Unable to load dashboard documents.",
  );
});

test("paginates filtered dashboard document searches", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => document(index));
  const request = vi
    .spyOn(api, "json")
    .mockResolvedValueOnce({ total: 101, documents: firstPage })
    .mockResolvedValueOnce({ total: 101, documents: [document(100)] });

  await searchDashboardDocuments("Invoice");

  expect(request).toHaveBeenNthCalledWith(
    2,
    "/v1/dashboard/documents?limit=100&offset=100&query=Invoice",
    {},
    "Unable to load dashboard documents.",
  );
});
