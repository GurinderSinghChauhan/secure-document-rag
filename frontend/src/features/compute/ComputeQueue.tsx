import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  computeKeys,
  getActiveComputeSession,
  getComputeSession,
  listQueueJobs,
  releaseJobs,
  retryIngestionJob,
} from "./api";
import type { IngestionJob } from "../../api/types";
import { Button, ProgressBar, StatusMessage } from "../../components/ui";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

function formatStage(stage: string, operation: IngestionJob["operation"]) {
  if (operation === "metadata_extraction") {
    const extractionStages: Record<string, string> = {
      completion: "Data extracted",
      completed: "Data extracted",
      failed: "Extraction failed",
      held: "Waiting to extract data",
    };
    if (extractionStages[stage]) return extractionStages[stage];
  }
  const stages: Record<string, string> = {
    cold_start: "Preparing worker",
    extracting: "Extracting content",
    metadata_extraction: "Extracting fields",
    chunking: "Preparing search chunks",
    vector_storage: "Building search index",
    metadata: "Finalizing document",
    completion: "Searchable",
    completed: "Searchable",
    failed: "Indexing failed",
    held: "Waiting to index",
  };
  return stages[stage] ?? stage.replaceAll("_", " ");
}

export function ComputeQueue({
  disabled,
  sessionId: controlledSessionId,
  onSessionIdChange,
}: {
  disabled: boolean;
  sessionId?: string | null;
  onSessionIdChange?: (sessionId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const requestedSessionId =
    controlledSessionId === undefined ? localSessionId : controlledSessionId;
  const activeSession = useQuery({
    queryKey: computeKeys.active,
    queryFn: getActiveComputeSession,
    enabled: !requestedSessionId,
  });
  const sessionId =
    requestedSessionId ?? activeSession.data?.session_id ?? null;
  function setSessionId(value: string | null) {
    setLocalSessionId(value);
    onSessionIdChange?.(value);
  }
  const queue = useQuery({
    queryKey: computeKeys.queue,
    queryFn: listQueueJobs,
    enabled: activeSession.isFetched && !sessionId,
    refetchInterval: sessionId ? false : 3000,
  });
  const session = useQuery({
    queryKey: computeKeys.session(sessionId ?? "inactive"),
    queryFn: () => getComputeSession(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: (query) =>
      query.state.data?.status === "closed" ? false : 2000,
  });
  const start = useMutation({
    mutationFn: async (jobs: IngestionJob[]) => {
      const ready = await Promise.all(
        jobs.map((job) =>
          job.state === "failed"
            ? retryIngestionJob(job.job_id)
            : Promise.resolve(job),
        ),
      );
      return releaseJobs(ready.map((job) => job.job_id));
    },
    onSuccess: async (value) => {
      setSessionId(value.session_id);
      await queryClient.invalidateQueries({ queryKey: computeKeys.queue });
    },
  });
  useEffect(() => {
    if (session.data?.status !== "closed") return;
    void queryClient.invalidateQueries({ queryKey: computeKeys.queue });
    void queryClient.invalidateQueries({ queryKey: ["documents", "indexed"] });
  }, [session.data?.status, queryClient]);
  const jobs = sessionId
    ? (session.data?.jobs ?? []).filter((job) => job.state !== "completed")
    : (queue.data ?? []);
  const message = sessionId
    ? session.data
      ? session.data.status === "closed"
        ? session.data.jobs.some((job) => job.state === "failed")
          ? "Processing finished with errors. Retry the failed documents below."
          : "Processing complete."
        : `${session.data.jobs.filter((job) => job.state === "completed").length} of ${session.data.jobs.length} documents complete. New uploads will join this session.`
      : "Restoring document processing…"
    : activeSession.isPending
      ? "Checking for active document processing…"
      : queue.isPending
        ? "Loading the processing queue…"
        : queue.error instanceof Error
          ? queue.error.message
          : queue.data?.length
            ? `${queue.data.length} ${queue.data.length === 1 ? "document needs" : "documents need"} attention.`
            : "No documents are waiting. New uploads start processing automatically.";
  const canStartFromSession = session.data?.status === "closed";
  const queuedJobs = jobs.filter(
    (job) => job.state === "failed" || job.state === "held_for_compute",
  );
  const failedCount = queuedJobs.filter(
    (job) => job.state === "failed" || Boolean(job.error_code),
  ).length;
  const heldCount = queuedJobs.length - failedCount;
  const queueActionAvailable =
    queuedJobs.length > 0 && (!sessionId || canStartFromSession);
  const queueActionLabel = failedCount
    ? heldCount
      ? `Retry queued work (${queuedJobs.length})`
      : `Retry failed work (${failedCount})`
    : `Start queued work (${heldCount})`;

  return (
    <section
      id="compute"
      className="processing-pane"
      aria-labelledby="compute-title"
    >
      <div className="compute-heading">
        <div className="workflow-subheading">
          <span className="section-kicker">Processing queue</span>
          <h3 id="compute-title">Processing status</h3>
        </div>
        <span className="auto-refresh-badge">
          <i aria-hidden="true" /> Auto-updating
        </span>
      </div>
      <StatusMessage className="panel-description">
        {start.error instanceof Error ? start.error.message : message}
      </StatusMessage>
      <div
        className={`held-jobs compute-queue ${sessionId ? "active-session" : ""}`}
      >
        {jobs.map((job) => {
          const failed = job.state === "failed";
          const held = job.state === "held_for_compute";
          return (
            <article
              className={`compute-job-card ${failed ? "failed" : ""}`}
              key={job.job_id}
            >
              <header>
                <strong>{job.document_name}</strong>
                <span>{job.progress}%</span>
              </header>
              <div className="compute-job-stage">
                <span>{formatStage(job.stage, job.operation ?? "index")}</span>
                <small>
                  {failed ? job.error_message || job.message : job.message}
                </small>
                {!sessionId && (
                  <small>
                    {formatBytes(job.size_bytes)} · ready for compute
                  </small>
                )}
              </div>
              {!failed && !held && (
                <div className="compute-job-progress">
                  <ProgressBar
                    variant="job"
                    label={`${job.document_name} processing progress`}
                    value={job.progress}
                  />
                </div>
              )}
            </article>
          );
        })}
        {!jobs.length && !queue.isPending && (
          <small>
            The queue is clear. Uploaded documents will appear here.
          </small>
        )}
      </div>
      {queueActionAvailable && (
        <Button
          variant="primary"
          className="full-button queue-batch-action"
          type="button"
          disabled={disabled || start.isPending}
          busy={start.isPending}
          busyLabel="Starting one GPU session…"
          onClick={() => start.mutate(queuedJobs)}
        >
          {queueActionLabel}
        </Button>
      )}
    </section>
  );
}
