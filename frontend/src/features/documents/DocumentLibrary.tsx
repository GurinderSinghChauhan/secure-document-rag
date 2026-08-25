import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteDocument, documentKeys, listDocuments } from "./api";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

export function DocumentLibrary() {
  const [search, setSearch] = useState("");
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
    <section
      id="indexed-documents"
      className="admin-card indexed-documents-card"
      aria-labelledby="indexed-documents-title"
    >
      <div className="compute-heading">
        <div className="panel-header">
          <span className="step-number">03</span>
          <div>
            <span className="section-kicker">Searchable knowledge</span>
            <h2 id="indexed-documents-title">Indexed documents</h2>
          </div>
        </div>
        <button
          className="icon-text-button"
          type="button"
          onClick={() => void documents.refetch()}
        >
          Refresh
        </button>
      </div>
      <p className="panel-description" role="status">
        {documents.isPending
          ? "Loading indexed documents…"
          : documents.error instanceof Error
            ? documents.error.message
            : `${matches.length} of ${documents.data?.length ?? 0} searchable documents shown.`}
      </p>
      <label className="indexed-document-search">
        <span className="sr-only">Search indexed documents</span>
        <input
          type="search"
          placeholder="Search by filename, type, role, or user"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
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
            </div>
            <button
              className="text-button danger-action"
              type="button"
              disabled={remove.isPending}
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
            </button>
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
    </section>
  );
}
