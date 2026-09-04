import { useEffect, useRef, useState } from "react";
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
  const [classificationFilter, setClassificationFilter] = useState<
    "all" | "needs_classification"
  >("all");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkDeleteError, setBulkDeleteError] = useState("");
  const [bulkClassifyError, setBulkClassifyError] = useState("");
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
    onSuccess: (_, documentId) => {
      setSelectedDocumentIds((current) => {
        const next = new Set(current);
        next.delete(documentId);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: documentKeys.indexed });
    },
  });
  const removeAll = useMutation({
    mutationFn: deleteAllDocuments,
    onSuccess: () => {
      setSelectedDocumentIds(new Set());
      void queryClient.invalidateQueries({ queryKey: documentKeys.indexed });
    },
  });
  const removeSelected = useMutation({
    mutationFn: async (documentIds: string[]) => {
      const results = await Promise.allSettled(documentIds.map(deleteDocument));
      return {
        deleted: documentIds.filter((_, index) =>
          results[index] ? results[index].status === "fulfilled" : false,
        ),
        failed: documentIds.filter((_, index) =>
          results[index] ? results[index].status === "rejected" : true,
        ),
      };
    },
    onSuccess: ({ deleted, failed }) => {
      setSelectedDocumentIds(new Set(failed));
      setBulkDeleteError(
        failed.length
          ? `${failed.length} selected ${failed.length === 1 ? "document could" : "documents could"} not be deleted. The failed selection has been kept so you can try again.`
          : "",
      );
      if (deleted.length)
        void queryClient.invalidateQueries({ queryKey: documentKeys.indexed });
    },
  });
  const schemas = useQuery({
    queryKey: schemaKeys.all,
    queryFn: listDocumentSchemas,
  });
  const classifySelected = useMutation({
    mutationFn: async (
      targets: { documentId: string; documentType: string }[],
    ) => {
      const results = await Promise.allSettled(
        targets.map(async (target) => ({
          target,
          job: await classifyDocument(target.documentId, target.documentType),
        })),
      );
      const completed = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = targets.filter(
        (_, index) => results[index]?.status === "rejected",
      );
      const session = completed.length
        ? await releaseJobs(completed.map(({ job }) => job.job_id))
        : undefined;
      return {
        session,
        completedIds: completed.map(({ target }) => target.documentId),
        failed,
      };
    },
    onSuccess: ({ session, completedIds, failed }) => {
      const completedIdSet = new Set(completedIds);
      setSelectedDocumentIds(
        new Set(failed.map(({ documentId }) => documentId)),
      );
      setClassificationChoices((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([documentId]) => !completedIdSet.has(documentId),
          ),
        ),
      );
      setBulkClassifyError(
        failed.length
          ? `${failed.length} selected ${failed.length === 1 ? "document could" : "documents could"} not be started. The failed selection has been kept so you can try again.`
          : "",
      );
      if (session) onComputeStarted?.(session.session_id);
      void queryClient.invalidateQueries({ queryKey: documentKeys.indexed });
      void queryClient.invalidateQueries({
        queryKey: ["compute", "queue"],
      });
    },
  });
  const needsClassification = (document: { classification_status: string }) =>
    document.classification_status === "unclassified" ||
    document.classification_status === "failed";
  const needsClassificationCount = (documents.data ?? []).filter(
    needsClassification,
  ).length;
  const matches = (documents.data ?? []).filter(
    (document) =>
      (classificationFilter === "all" || needsClassification(document)) &&
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
  const selectedAvailableDocumentIds = (documents.data ?? [])
    .map((document) => document.document_id)
    .filter((documentId) => selectedDocumentIds.has(documentId));
  const selectedClassifiableDocuments = (documents.data ?? []).filter(
    (document) =>
      selectedDocumentIds.has(document.document_id) &&
      (document.classification_status === "unclassified" ||
        document.classification_status === "failed"),
  );
  const selectedDocumentsReadyToClassify =
    selectedClassifiableDocuments.length > 0 &&
    selectedClassifiableDocuments.length ===
      selectedAvailableDocumentIds.length &&
    selectedClassifiableDocuments.every(
      (document) => classificationChoices[document.document_id],
    );
  const visibleDocumentIds = matches.map((document) => document.document_id);
  const selectedVisibleCount = visibleDocumentIds.filter((documentId) =>
    selectedDocumentIds.has(documentId),
  ).length;
  const allVisibleSelected =
    visibleDocumentIds.length > 0 &&
    selectedVisibleCount === visibleDocumentIds.length;
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate =
        selectedVisibleCount > 0 && !allVisibleSelected;
  }, [allVisibleSelected, selectedVisibleCount]);

  const deletionPending =
    remove.isPending || removeSelected.isPending || removeAll.isPending;
  return (
    <Panel
      id="indexed-documents"
      className="indexed-documents-card"
      labelledBy="indexed-documents-title"
    >
      <PanelHeader
        step="02"
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
      <div
        className="indexed-document-filters"
        role="group"
        aria-label="Filter documents by classification status"
      >
        <Button
          variant="text"
          className="indexed-document-filter"
          aria-pressed={classificationFilter === "all"}
          onClick={() => {
            setClassificationFilter("all");
            setSelectedDocumentIds(new Set());
            setBulkDeleteError("");
            setBulkClassifyError("");
          }}
        >
          All documents ({documents.data?.length ?? 0})
        </Button>
        <Button
          variant="text"
          className="indexed-document-filter"
          aria-pressed={classificationFilter === "needs_classification"}
          onClick={() => {
            setClassificationFilter("needs_classification");
            setSelectedDocumentIds(new Set());
            setBulkDeleteError("");
            setBulkClassifyError("");
          }}
        >
          Needs classification ({needsClassificationCount})
        </Button>
      </div>
      <div className="indexed-document-toolbar">
        <div className="indexed-document-selection">
          <label>
            <Input
              ref={selectAllRef}
              type="checkbox"
              checked={allVisibleSelected}
              disabled={
                !visibleDocumentIds.length ||
                deletionPending ||
                classifySelected.isPending
              }
              onChange={() => {
                setBulkDeleteError("");
                setBulkClassifyError("");
                setSelectedDocumentIds((current) => {
                  const next = new Set(current);
                  visibleDocumentIds.forEach((documentId) => {
                    if (allVisibleSelected) next.delete(documentId);
                    else next.add(documentId);
                  });
                  return next;
                });
              }}
            />
            Select all shown
          </label>
          <strong>{selectedAvailableDocumentIds.length} selected</strong>
          {selectedAvailableDocumentIds.length > 0 && (
            <Button
              variant="text"
              type="button"
              disabled={deletionPending || classifySelected.isPending}
              onClick={() => {
                setBulkDeleteError("");
                setBulkClassifyError("");
                setSelectedDocumentIds(new Set());
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="indexed-document-bulk-actions">
          <Button
            variant="text"
            type="button"
            disabled={
              !selectedDocumentsReadyToClassify ||
              classifySelected.isPending ||
              deletionPending
            }
            busy={classifySelected.isPending}
            busyLabel="Starting extraction…"
            onClick={() => {
              setBulkClassifyError("");
              classifySelected.mutate(
                selectedClassifiableDocuments.map((document) => ({
                  documentId: document.document_id,
                  documentType:
                    classificationChoices[document.document_id] ?? "",
                })),
              );
            }}
          >
            Apply types &amp; extract data
          </Button>
          <Button
            variant="text"
            className="danger-action"
            type="button"
            disabled={
              !selectedAvailableDocumentIds.length ||
              deletionPending ||
              classifySelected.isPending
            }
            busy={removeSelected.isPending}
            busyLabel="Deleting selected…"
            onClick={() => {
              const selectedIds = selectedAvailableDocumentIds;
              if (
                confirm(
                  `Delete ${selectedIds.length} selected ${selectedIds.length === 1 ? "document" : "documents"} from this organization? This cannot be undone.`,
                )
              ) {
                setBulkDeleteError("");
                removeSelected.mutate(selectedIds);
              }
            }}
          >
            Delete selected
          </Button>
          <Button
            variant="text"
            className="danger-action"
            type="button"
            disabled={
              !documents.data?.length ||
              deletionPending ||
              classifySelected.isPending
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
      </div>
      <span className="indexed-document-delete-note">
        Delete all includes documents outside the current search.
      </span>
      <div className="indexed-document-list">
        {matches.map((document) => (
          <article
            className={`indexed-document-row${selectedDocumentIds.has(document.document_id) ? " selected" : ""}`}
            key={document.document_id}
          >
            <Input
              className="indexed-document-select"
              type="checkbox"
              aria-label={`Select ${document.document_name}`}
              checked={selectedDocumentIds.has(document.document_id)}
              disabled={deletionPending || classifySelected.isPending}
              onChange={(event) => {
                setBulkDeleteError("");
                setBulkClassifyError("");
                setSelectedDocumentIds((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(document.document_id);
                  else next.delete(document.document_id);
                  return next;
                });
              }}
            />
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
                <Select
                  aria-label={`Classification for ${document.document_name}`}
                  disabled={
                    !selectedDocumentIds.has(document.document_id) ||
                    deletionPending ||
                    classifySelected.isPending
                  }
                  value={classificationChoices[document.document_id] ?? ""}
                  onChange={(event) => {
                    setBulkClassifyError("");
                    setClassificationChoices((current) => ({
                      ...current,
                      [document.document_id]: event.target.value,
                    }));
                  }}
                >
                  <option value="">Select document type</option>
                  {schemas.data?.map((industry) => (
                    <optgroup label={industry.label} key={industry.key}>
                      {industry.document_types.map((documentType) => (
                        <option value={documentType.key} key={documentType.key}>
                          {documentType.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
              <Button
                variant="text"
                className="danger-action"
                type="button"
                disabled={deletionPending || classifySelected.isPending}
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
      {classifySelected.error instanceof Error && (
        <StatusMessage className="upload-status error">
          {classifySelected.error.message}
        </StatusMessage>
      )}
      {bulkClassifyError && (
        <StatusMessage className="upload-status error">
          {bulkClassifyError}
        </StatusMessage>
      )}
      {bulkDeleteError && (
        <StatusMessage className="upload-status error">
          {bulkDeleteError}
        </StatusMessage>
      )}
    </Panel>
  );
}
