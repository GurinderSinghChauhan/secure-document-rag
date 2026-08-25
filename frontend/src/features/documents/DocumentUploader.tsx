import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { uploadDocument, type UploadProgress } from "./api";

export function DocumentUploader({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [roles, setRoles] = useState("");
  const [users, setUsers] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [status, setStatus] = useState("Select one or more files to begin.");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!files.length) return;
    setBusy(true);
    const failed: string[] = [];
    let queued = 0;
    for (const [index, file] of files.entries()) {
      try {
        await uploadDocument(file, roles, users, (value) =>
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
    <section
      id="documents"
      className="admin-card workflow-card"
      aria-labelledby="upload-title"
    >
      <header className="panel-header">
        <span className="step-number">01</span>
        <div>
          <span className="section-kicker">Add knowledge</span>
          <h2 id="upload-title">Upload documents</h2>
        </div>
      </header>
      <p className="panel-description">
        Files are encrypted and held safely. Nothing starts compute until you
        explicitly release it.
      </p>
      <form className="upload-form" onSubmit={(event) => void submit(event)}>
        <label className="file-dropzone">
          <input
            type="file"
            accept="text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg,image/webp"
            multiple
            required
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
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
        <details className="access-disclosure">
          <summary>
            Advanced access controls <span>Optional</span>
          </summary>
          <fieldset className="access-fieldset">
            <legend className="sr-only">Document access</legend>
            <p>Leave blank to inherit the administrator role.</p>
            <label>
              <span>Allowed roles</span>
              <input
                value={roles}
                onChange={(event) => setRoles(event.target.value)}
                placeholder="member, admin"
              />
            </label>
            <label>
              <span>Allowed users</span>
              <input
                value={users}
                onChange={(event) => setUsers(event.target.value)}
                placeholder="user-123, user-456"
              />
            </label>
          </fieldset>
        </details>
        <div className="upload-status" role="status">
          ⓘ {progress?.message ?? status}
        </div>
        {progress && (
          <div className="upload-progress">
            <Progress label="Upload" value={progress.upload} />
            <Progress label="Processing" value={progress.indexing} />
          </div>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={disabled || busy || !files.length}
        >
          <span>
            {busy
              ? "Uploading…"
              : `Upload and hold${files.length > 1 ? ` ${files.length}` : ""}`}
          </span>
        </button>
      </form>
    </section>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const rounded = Math.round(value);
  return (
    <div className="upload-progress-row">
      <span>{label}</span>
      <div
        className="upload-progress-track"
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
      >
        <span
          className="upload-progress-fill"
          style={{ width: `${rounded}%` }}
        />
      </div>
      <strong>{rounded}%</strong>
    </div>
  );
}
