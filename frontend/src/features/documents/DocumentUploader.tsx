import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  FormField,
  Input,
  Panel,
  PanelHeader,
  ProgressBar,
  Select,
} from "../../components/ui";
import {
  batchUploadPercentage,
  listDocumentSchemas,
  schemaKeys,
  uploadDocument,
  type UploadProgress,
} from "./api";

export function DocumentUploader({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [selectionSource, setSelectionSource] = useState<
    "documents" | "folder" | null
  >(null);
  const [folderName, setFolderName] = useState("");
  const [roles, setRoles] = useState("");
  const [users, setUsers] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [status, setStatus] = useState(
    "Choose documents to upload. They will remain held until you release them.",
  );
  const [statusTone, setStatusTone] = useState<"neutral" | "success" | "error">(
    "neutral",
  );
  const [busy, setBusy] = useState(false);
  const schemas = useQuery({
    queryKey: schemaKeys.all,
    queryFn: listDocumentSchemas,
  });
  function selectFiles(selectedFiles: FileList | null) {
    const nextFiles = Array.from(selectedFiles ?? []);
    setFiles(nextFiles);
    setSelectionSource(nextFiles.length ? "documents" : null);
    setFolderName("");
    setProgress(null);
    setStatusTone("neutral");
    setStatus(
      nextFiles.length
        ? `${nextFiles.length} ${nextFiles.length === 1 ? "document" : "documents"} ready to upload.`
        : "Choose documents to upload. They will remain held until you release them.",
    );
  }
  function selectPdfFolder(selectedFiles: FileList | null) {
    const folderFiles = Array.from(selectedFiles ?? []);
    const pdfFiles = folderFiles.filter(
      (file) =>
        file.type === "application/pdf" ||
        (!file.type && file.name.toLowerCase().endsWith(".pdf")),
    );
    const ignored = folderFiles.length - pdfFiles.length;
    const relativePath = pdfFiles[0]?.webkitRelativePath ?? "";
    const selectedFolder = relativePath.split("/")[0] ?? "";
    setFiles(pdfFiles);
    setSelectionSource(pdfFiles.length ? "folder" : null);
    setFolderName(selectedFolder);
    setProgress(null);
    setStatusTone(pdfFiles.length ? "neutral" : "error");
    setStatus(
      `${pdfFiles.length} ${pdfFiles.length === 1 ? "PDF" : "PDFs"} selected.${
        ignored
          ? ` ${ignored} non-PDF ${ignored === 1 ? "file was" : "files were"} ignored.`
          : ""
      }`,
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setStatusTone("neutral");
    const failed: File[] = [];
    let queued = 0;
    for (const [index, file] of files.entries()) {
      try {
        await uploadDocument(file, roles, users, documentType, (value) =>
          setProgress({
            ...value,
            percentage: batchUploadPercentage(
              index,
              files.length,
              value.percentage,
            ),
            message:
              files.length > 1
                ? `Document ${index + 1} of ${files.length}: ${value.message}`
                : value.message,
          }),
        );
        queued += 1;
      } catch {
        failed.push(file);
      }
    }
    setStatus(
      failed.length
        ? `${queued} of ${files.length} saved. Retry: ${failed.map((file) => file.name).join(", ")}.`
        : `${queued} ${queued === 1 ? "document is" : "documents are"} saved and waiting for release.`,
    );
    setStatusTone(failed.length ? "error" : "success");
    setFiles(failed);
    if (!failed.length) {
      setSelectionSource(null);
      setFolderName("");
    }
    setProgress(null);
    await queryClient.invalidateQueries({ queryKey: ["compute", "held-jobs"] });
    setBusy(false);
  }
  return (
    <Panel id="documents" className="workflow-card" labelledBy="upload-title">
      <PanelHeader
        step="01"
        kicker="Add knowledge"
        title="Upload documents"
        titleId="upload-title"
      />
      <p className="panel-description">
        Files are encrypted and held safely. Nothing starts compute until you
        explicitly release it.
      </p>
      <form className="upload-form" onSubmit={(event) => void submit(event)}>
        <FormField
          className="document-type-field"
          label="Document type"
          hint="Auto-detect classifies each document independently. Select a type only to override detection for every selected file."
        >
          <Select
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
          >
            <option value="">Auto-detect document type</option>
            {schemas.data?.map((industry) => (
              <optgroup label={industry.label} key={industry.key}>
                {industry.document_types.map((document) => (
                  <option value={document.key} key={document.key}>
                    {document.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </FormField>
        <div className="file-source-grid">
          <label
            className={`file-dropzone ${selectionSource === "documents" ? "selected" : ""}`}
          >
            <Input
              aria-label="Choose individual documents"
              type="file"
              accept="text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => selectFiles(event.target.files)}
            />
            <span className="upload-icon" aria-hidden="true">
              ↑
            </span>
            <strong>
              {selectionSource === "documents" && files.length
                ? files.length === 1
                  ? files[0]?.name
                  : `${files.length} documents selected`
                : "Choose documents"}
            </strong>
            <span>or drag and drop them here</span>
            <small>
              PDF, DOCX, PPTX, XLSX, TXT, PNG, JPEG, or WebP · up to 25 MB each
            </small>
          </label>
          <label
            className={`file-dropzone folder-dropzone ${selectionSource === "folder" ? "selected" : ""}`}
          >
            <Input
              aria-label="Choose a folder of PDF files"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              ref={(input) => input?.setAttribute("webkitdirectory", "")}
              onChange={(event) => selectPdfFolder(event.target.files)}
            />
            <span className="upload-icon" aria-hidden="true">
              ▣
            </span>
            <strong>
              {selectionSource === "folder" && files.length
                ? folderName || "Selected PDF folder"
                : "Choose a PDF folder"}
            </strong>
            <span>
              {selectionSource === "folder" && files.length
                ? `${files.length} PDF ${files.length === 1 ? "file" : "files"} contained · ready to upload`
                : "Include nested folders"}
            </span>
            <small>
              Only PDF files are selected; every other file is ignored
            </small>
          </label>
        </div>
        <details className="access-disclosure">
          <summary>
            Advanced access controls <span>Optional</span>
          </summary>
          <fieldset className="access-fieldset">
            <legend className="sr-only">Document access</legend>
            <p>Leave blank to inherit the administrator role.</p>
            <FormField label="Allowed roles">
              <Input
                value={roles}
                onChange={(event) => setRoles(event.target.value)}
                placeholder="member, admin"
              />
            </FormField>
            <FormField label="Allowed users">
              <Input
                value={users}
                onChange={(event) => setUsers(event.target.value)}
                placeholder="user-123, user-456"
              />
            </FormField>
          </fieldset>
        </details>
        <div
          className={`upload-status ${statusTone} ${busy ? "busy" : ""}`}
          role="status"
        >
          <span aria-hidden="true">{statusTone === "success" ? "✓" : "ⓘ"}</span>
          {progress?.message ?? status}
        </div>
        {progress &&
          (files.length > 1 ||
            (progress.phase === "uploading" && progress.percentage < 100)) && (
            <div className="upload-progress">
              <ProgressBar
                label={
                  selectionSource === "folder"
                    ? "Folder upload"
                    : "Batch upload"
                }
                value={progress.percentage}
                showValue
              />
            </div>
          )}
        <Button
          variant="primary"
          type="submit"
          disabled={disabled || !files.length}
          busy={busy}
          busyLabel={<span>Securing documents…</span>}
        >
          <span>
            {files.length
              ? `Upload and hold${files.length > 1 ? ` ${files.length}` : ""}`
              : "Choose documents to upload"}
          </span>
        </Button>
      </form>
    </Panel>
  );
}
