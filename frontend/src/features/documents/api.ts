import { api, errorMessage } from "../../api/client";
import type { IndexedDocument, IndustrySchema } from "../../api/types";

export const documentKeys = { indexed: ["documents", "indexed"] as const };
export const schemaKeys = { all: ["document-schemas"] as const };
export const listDocumentSchemas = () =>
  api.json<IndustrySchema[]>(
    "/v1/document-schemas",
    {},
    "Unable to load document types.",
  );
export async function listDocuments() {
  const pageSize = 500;
  const documents: IndexedDocument[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await api.json<IndexedDocument[]>(
      `/v1/admin/documents?limit=${pageSize}&offset=${offset}`,
      {},
      "Unable to load indexed documents.",
    );
    documents.push(...page);
    if (page.length < pageSize) return documents;
  }
}
export const deleteDocument = (id: string) =>
  api.json<{ document_id: string; status: string }>(
    `/v1/documents/${id}`,
    { method: "DELETE" },
    "Unable to delete the document.",
  );
export const deleteAllDocuments = () =>
  api.json<{ deleted_count: number; status: string }>(
    "/v1/admin/documents",
    { method: "DELETE" },
    "Unable to delete all documents.",
  );

export interface UploadProgress {
  phase: "uploading" | "securing";
  percentage: number;
  message: string;
}
export interface UploadResult {
  job_id: string;
}

export function batchUploadPercentage(
  fileIndex: number,
  fileCount: number,
  filePercentage: number,
) {
  if (fileCount <= 0) return 0;
  const boundedFilePercentage = Math.min(Math.max(filePercentage, 0), 100);
  return Math.min(100, (fileIndex * 100 + boundedFilePercentage) / fileCount);
}

export function uploadDocument(
  file: File,
  roles: string,
  users: string,
  documentType: string,
  onProgress: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let offset = 0;
    let buffer = "";
    let complete: UploadResult | undefined;
    let streamError: Error | undefined;
    function process(done = false) {
      buffer += request.responseText.slice(offset);
      offset = request.responseText.length;
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as {
          type: string;
          detail?: string;
          percentage?: number;
          message?: string;
          job_id?: string;
        };
        if (event.type === "error")
          streamError = new Error(
            event.detail || "Unable to save the document.",
          );
        if (event.type === "complete" && event.job_id)
          complete = { job_id: event.job_id };
        if (event.type === "progress")
          onProgress({
            phase: "securing",
            percentage: 100,
            message: event.message || `Securing ${file.name}…`,
          });
      }
    }
    request.open("POST", "/v1/documents/stream");
    const token = api.getAccessToken();
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("X-Document-Name", file.name);
    request.setRequestHeader(
      "Content-Type",
      file.type ||
        (file.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "text/plain"),
    );
    if (documentType) request.setRequestHeader("X-Document-Type", documentType);
    if (roles.trim()) request.setRequestHeader("X-Allowed-Roles", roles.trim());
    if (users.trim()) request.setRequestHeader("X-Allowed-Users", users.trim());
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable)
        onProgress({
          phase: "uploading",
          percentage: (event.loaded / event.total) * 100,
          message: `Uploading ${file.name}…`,
        });
    });
    request.upload.addEventListener("load", () =>
      onProgress({
        phase: "securing",
        percentage: 100,
        message: `Upload complete. Securing ${file.name}…`,
      }),
    );
    request.addEventListener("progress", () => process());
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        let body: unknown = {};
        try {
          body = JSON.parse(request.responseText);
        } catch {
          /* response is not JSON */
        }
        reject(new Error(errorMessage(body, "Unable to save the document.")));
        return;
      }
      process(true);
      if (streamError) reject(streamError);
      else if (complete) resolve(complete);
      else
        reject(
          new Error("The upload service returned an incomplete response."),
        );
    });
    request.addEventListener("error", () =>
      reject(new Error("Unable to connect to the RAG service.")),
    );
    request.send(file);
  });
}
