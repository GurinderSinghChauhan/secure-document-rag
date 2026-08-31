import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteDocument, documentKeys, listDocuments } from "./api";
import {
  Button,
  FormField,
  Input,
  Panel,
  PanelHeader,
  StatusMessage,
} from "../../components/ui";

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
            <Button
              variant="text"
              className="danger-action"
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
            </Button>
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
    </Panel>
  );
}
