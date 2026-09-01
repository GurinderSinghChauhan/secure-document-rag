import { vi } from "vitest";
import { api } from "../../api/client";
import type { IndexedDocument } from "../../api/types";
import { listDocuments } from "./api";

function document(index: number): IndexedDocument {
  return { document_id: `document-${index}` } as IndexedDocument;
}

test("loads every indexed-document page beyond the first 500 records", async () => {
  const firstPage = Array.from({ length: 500 }, (_, index) => document(index));
  const secondPage = [document(500)];
  const request = vi
    .spyOn(api, "json")
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(secondPage);

  const result = await listDocuments();

  expect(result).toHaveLength(501);
  expect(request).toHaveBeenNthCalledWith(
    1,
    "/v1/admin/documents?limit=500&offset=0",
    {},
    "Unable to load indexed documents.",
  );
  expect(request).toHaveBeenNthCalledWith(
    2,
    "/v1/admin/documents?limit=500&offset=500",
    {},
    "Unable to load indexed documents.",
  );
});
