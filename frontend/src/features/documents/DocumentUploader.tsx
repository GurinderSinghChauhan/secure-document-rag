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
  listDocumentSchemas,
  schemaKeys,
  uploadDocument,
  type UploadProgress,
} from "./api";

export function DocumentUploader({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [roles, setRoles] = useState("");
  const [users, setUsers] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [status, setStatus] = useState("Select one or more files to begin.");
  const [busy, setBusy] = useState(false);
  const schemas = useQuery({
    queryKey: schemaKeys.all,
    queryFn: listDocumentSchemas,
  });
  function selectFiles(selectedFiles: FileList | null) {
    setFiles(Array.from(selectedFiles ?? []));
    setProgress(null);
    setStatus("Select one or more files to begin.");
  }
  function selectPdfFolder(selectedFiles: FileList | null) {
    const folderFiles = Array.from(selectedFiles ?? []);
    const pdfFiles = folderFiles.filter(
      (file) =>
        file.type === "application/pdf" ||
        (!file.type && file.name.toLowerCase().endsWith(".pdf")),
    );
    const ignored = folderFiles.length - pdfFiles.length;
    setFiles(pdfFiles);
    setProgress(null);
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
    const failed: string[] = [];
    let queued = 0;
    for (const [index, file] of files.entries()) {
      try {
        await uploadDocument(file, roles, users, documentType, (value) =>
          setProgress({
            ...value,
            message:
              files.length > 1
                ? `Document ${index + 1} of ${files.length}: ${value.message}`
                : value.message,
          }),
        );
        queued += 1;
      } catch {
        failed.push(file.name);
      }
    }
    setStatus(
      failed.length
        ? `${queued} of ${files.length} saved. Failed: ${failed.join(", ")}.`
        : `${queued} ${queued === 1 ? "document is" : "documents are"} saved and waiting for release.`,
    );
    if (!failed.length) setFiles([]);
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
          label="Document type"
          hint="Selecting a type enables schema-aligned metadata extraction."
        >
          <Select
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
          >
            <option value="">Unclassified / general document</option>
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
          <label className="file-dropzone">
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
              {files.length
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
          <label className="file-dropzone folder-dropzone">
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
            <strong>Choose a PDF folder</strong>
            <span>Include nested folders</span>
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
        <div className="upload-status" role="status">
          ⓘ {progress?.message ?? status}
        </div>
        {progress && (
          <div className="upload-progress">
            <ProgressBar label="Upload" value={progress.upload} showValue />
            <ProgressBar
              label="Processing"
              value={progress.indexing}
              showValue
            />
          </div>
        )}
        <Button
          variant="primary"
          type="submit"
          disabled={disabled || !files.length}
          busy={busy}
          busyLabel={<span>Uploading…</span>}
        >
          <span>
            Upload and hold{files.length > 1 ? ` ${files.length}` : ""}
          </span>
        </Button>
      </form>
    </Panel>
  );
}
