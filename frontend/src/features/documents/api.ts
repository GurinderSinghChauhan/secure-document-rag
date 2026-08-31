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
export const listDocuments = () =>
  api.json<IndexedDocument[]>(
    "/v1/admin/documents",
    {},
    "Unable to load indexed documents.",
  );
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
  upload: number;
  indexing: number;
  message: string;
}
export interface UploadResult {
  job_id: string;
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
            upload: 100,
            indexing: event.percentage ?? 0,
            message: event.message || `Saving ${file.name}…`,
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
          upload: (event.loaded / event.total) * 100,
          indexing: 0,
          message: `Uploading ${file.name}…`,
        });
    });
    request.upload.addEventListener("load", () =>
      onProgress({
        upload: 100,
        indexing: 0,
        message: `Upload complete. Saving ${file.name} for compute…`,
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
