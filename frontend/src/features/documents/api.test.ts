import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../api/client";
import type { IndexedDocument } from "../../api/types";
import { listDocuments, uploadDocument, type UploadProgress } from "./api";

afterEach(() => vi.unstubAllGlobals());

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

test("moves a fast upload from byte progress to securing state", async () => {
  const requestListeners = new Map<string, (event: ProgressEvent) => void>();
  const uploadListeners = new Map<string, (event: ProgressEvent) => void>();

  class FakeXMLHttpRequest {
    responseText =
      '{"type":"complete","job_id":"job-1","state":"held_for_compute"}\n';
    status = 200;
    upload = {
      addEventListener: (
        type: string,
        listener: (event: ProgressEvent) => void,
      ) => uploadListeners.set(type, listener),
    };

    open() {}
    setRequestHeader() {}
    addEventListener(type: string, listener: (event: ProgressEvent) => void) {
      requestListeners.set(type, listener);
    }
    send() {
      uploadListeners.get("progress")?.({
        lengthComputable: true,
        loaded: 10,
        total: 10,
      } as ProgressEvent);
      uploadListeners.get("load")?.(new ProgressEvent("load"));
      requestListeners.get("load")?.(new ProgressEvent("load"));
    }
  }

  vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
  const updates: UploadProgress[] = [];

  await expect(
    uploadDocument(
      new File(["pdf"], "invoice.pdf", { type: "application/pdf" }),
      "",
      "",
      "",
      (progress) => updates.push(progress),
    ),
  ).resolves.toEqual({ job_id: "job-1" });

  expect(updates).toEqual([
    {
      phase: "uploading",
      percentage: 100,
      message: "Uploading invoice.pdf…",
    },
    {
      phase: "securing",
      percentage: 100,
      message: "Upload complete. Securing invoice.pdf…",
    },
  ]);
});
