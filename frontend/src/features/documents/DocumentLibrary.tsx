import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  classifyDocument,
  deleteAllDocuments,
  deleteDocument,
  documentKeys,
  listDocuments,
  listDocumentSchemas,
  schemaKeys,
} from "./api";
import { releaseJobs } from "../compute/api";
import {
  Button,
  FormField,
  Input,
  Panel,
  PanelHeader,
  Select,
  StatusMessage,
} from "../../components/ui";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

export function DocumentLibrary({
  onComputeStarted,
}: {
  onComputeStarted?: (sessionId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [classificationChoices, setClassificationChoices] = useState<
    Record<string, string>
  >({});
  const queryClient = useQueryClient();
  const documents = useQuery({
    queryKey: documentKeys.indexed,
    queryFn: listDocuments,
  });
  const remove = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: documentKeys.indexed }),
  });
  const removeAll = useMutation({
    mutationFn: deleteAllDocuments,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: documentKeys.indexed }),
  });
  const schemas = useQuery({
    queryKey: schemaKeys.all,
    queryFn: listDocumentSchemas,
  });
  const classify = useMutation({
    mutationFn: async ({
      documentId,
      documentType,
    }: {
      documentId: string;
      documentType: string;
    }) => {
      const job = await classifyDocument(documentId, documentType);
      return releaseJobs(
        [job.job_id],
        Math.max(job.recommended_gpu_minutes, 1),
      );
    },
    onSuccess: (session) => {
      onComputeStarted?.(session.session_id);
      void queryClient.invalidateQueries({ queryKey: documentKeys.indexed });
      void queryClient.invalidateQueries({
        queryKey: ["compute", "held-jobs"],
      });
    },
  });
  const matches = (documents.data ?? []).filter((document) =>
    [
      document.document_name,
      document.content_type,
      document.created_by,
      ...document.allowed_roles,
      ...document.allowed_users,
    ].some((value) =>
      value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ),
  );
  return (
    <Panel
      id="indexed-documents"
      className="indexed-documents-card"
      labelledBy="indexed-documents-title"
    >
      <PanelHeader
        step="03"
        kicker="Searchable knowledge"
        title="Indexed documents"
        titleId="indexed-documents-title"
        action={
          <Button variant="icon-text" onClick={() => void documents.refetch()}>
            Refresh
          </Button>
        }
      />
      <StatusMessage className="panel-description">
        {documents.isPending
          ? "Loading indexed documents…"
          : documents.error instanceof Error
            ? documents.error.message
            : `${matches.length} of ${documents.data?.length ?? 0} searchable documents shown.`}
      </StatusMessage>
      <FormField
        className="indexed-document-search"
        label="Search indexed documents"
        labelHidden
      >
        <Input
          type="search"
          placeholder="Search by filename, type, role, or user"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </FormField>
      <div className="indexed-document-toolbar">
        <span>
          Delete all removes every indexed document in this organization,
          including documents outside the current search.
        </span>
        <Button
          variant="text"
          className="danger-action"
          type="button"
          disabled={
            !documents.data?.length || remove.isPending || removeAll.isPending
          }
          busy={removeAll.isPending}
          busyLabel="Deleting all…"
          onClick={() => {
            const count = documents.data?.length ?? 0;
            if (
              confirm(
                `Delete all indexed documents in this organization? At least ${count} ${count === 1 ? "document" : "documents"} will be removed. This cannot be undone.`,
              )
            )
              removeAll.mutate();
          }}
        >
          Delete all documents
        </Button>
      </div>
      <div className="indexed-document-list">
        {matches.map((document) => (
          <article className="indexed-document-row" key={document.document_id}>
            <div className="indexed-document-main">
              <strong>{document.document_name}</strong>
              <small>
                {formatBytes(document.size_bytes)} · {document.chunk_count}{" "}
                chunks · indexed{" "}
                {new Date(document.created_at).toLocaleDateString()}
              </small>
              <small>
                Roles: {document.allowed_roles.join(", ") || "none"} · Explicit
                users: {document.allowed_users.join(", ") || "none"}
              </small>
              <small>
                Classification:{" "}
                {document.classification_status.replaceAll("_", " ")}
                {typeof document.classification_confidence === "number"
                  ? ` · ${Math.round(document.classification_confidence * 100)}% confidence`
                  : ""}
              </small>
            </div>
            <div className="indexed-document-actions">
              {(document.classification_status === "unclassified" ||
                document.classification_status === "failed") && (
                <>
                  <Select
                    aria-label={`Classification for ${document.document_name}`}
                    value={classificationChoices[document.document_id] ?? ""}
                    onChange={(event) =>
                      setClassificationChoices((current) => ({
                        ...current,
                        [document.document_id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select document type</option>
                    {schemas.data?.map((industry) => (
                      <optgroup label={industry.label} key={industry.key}>
                        {industry.document_types.map((documentType) => (
                          <option
                            value={documentType.key}
                            key={documentType.key}
                          >
                            {documentType.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <Button
                    variant="text"
                    type="button"
                    disabled={
                      !classificationChoices[document.document_id] ||
                      classify.isPending ||
                      remove.isPending ||
                      removeAll.isPending
                    }
                    busy={
                      classify.isPending &&
                      classify.variables?.documentId === document.document_id
                    }
                    busyLabel="Starting pipeline…"
                    onClick={() =>
                      classify.mutate({
                        documentId: document.document_id,
                        documentType:
                          classificationChoices[document.document_id] ?? "",
                      })
                    }
                  >
                    Classify & complete indexing
                  </Button>
                </>
              )}
              <Button
                variant="text"
                className="danger-action"
                type="button"
                disabled={remove.isPending || removeAll.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Delete “${document.document_name}” from this organization's searchable index? This cannot be undone.`,
                    )
                  )
                    remove.mutate(document.document_id);
                }}
              >
                Delete
              </Button>
            </div>
          </article>
        ))}
        {!matches.length && !documents.isPending && (
          <p className="empty-admin-list">
            {documents.data?.length
              ? "No indexed documents match this search."
              : "No indexed documents in this organization."}
          </p>
        )}
      </div>
      {classify.error instanceof Error && (
        <StatusMessage className="upload-status error">
          {classify.error.message}
        </StatusMessage>
      )}
    </Panel>
  );
}
