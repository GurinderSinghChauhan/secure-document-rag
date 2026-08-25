import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  computeKeys,
  getComputeSession,
  listHeldJobs,
  releaseJobs,
} from "./api";

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

export function ComputeQueue({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const held = useQuery({ queryKey: computeKeys.held, queryFn: listHeldJobs });
  const session = useQuery({
    queryKey: computeKeys.session(sessionId ?? "inactive"),
    queryFn: () => getComputeSession(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: (query) =>
      query.state.data?.status === "closed" ? false : 2000,
  });
  const chosen = useMemo(
    () => (held.data ?? []).filter((job) => selected.has(job.job_id)),
    [held.data, selected],
  );
  const minutes = chosen.reduce(
    (total, job) => total + Number(job.recommended_gpu_minutes || 0),
    0,
  );
  const release = useMutation({
    mutationFn: () => releaseJobs([...selected], minutes),
    onSuccess: (value) => setSessionId(value.session_id),
  });
  useEffect(() => {
    if (session.data?.status !== "closed") return;
    void queryClient.invalidateQueries({ queryKey: computeKeys.held });
    void queryClient.invalidateQueries({ queryKey: ["documents", "indexed"] });
  }, [session.data?.status, queryClient]);
  const jobs = sessionId ? (session.data?.jobs ?? []) : (held.data ?? []);
  const message = sessionId
    ? session.data
      ? session.data.status === "closed"
        ? `Session closed. GPU capacity released after ${(session.data.gpu_seconds / 60).toFixed(1)} recorded GPU minutes. Estimated cost: $${session.data.estimated_cost_usd.toFixed(4)}.`
        : `Session ${session.data.status}: ${(session.data.gpu_seconds / 60).toFixed(1)} of ${session.data.max_gpu_minutes} GPU minutes used.`
      : "Opening compute session…"
    : held.isPending
      ? "Loading held documents…"
      : held.error instanceof Error
        ? held.error.message
        : chosen.length
          ? `${chosen.length} of ${held.data?.length ?? 0} waiting documents selected. Estimated GPU time: ${minutes} minutes.`
          : held.data?.length
            ? `${held.data.length} documents safely held. Select individual files or all waiting documents.`
            : "Nothing is waiting for compute.";
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <section
      id="compute"
      className="admin-card workflow-card"
      aria-labelledby="compute-title"
    >
      <div className="compute-heading">
        <div className="panel-header">
          <span className="step-number">02</span>
          <div>
            <span className="section-kicker">Controlled processing</span>
            <h2 id="compute-title">Release to compute</h2>
          </div>
        </div>
        <button
          className="icon-text-button"
          type="button"
          disabled={Boolean(sessionId)}
          onClick={() => void held.refetch()}
        >
          Refresh
        </button>
      </div>
      <p className="panel-description" role="status">
        {release.error instanceof Error ? release.error.message : message}
      </p>
      {!sessionId && (
        <div className="compute-selection-toolbar">
          <label>
            <input
              type="checkbox"
              checked={
                Boolean(held.data?.length) &&
                selected.size === held.data?.length
              }
              ref={(input) => {
                if (input)
                  input.indeterminate =
                    selected.size > 0 &&
                    selected.size < (held.data?.length ?? 0);
              }}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? new Set((held.data ?? []).map((job) => job.job_id))
                    : new Set(),
                )
              }
            />{" "}
            Select all waiting
          </label>
          <button
            className="text-button"
            type="button"
            disabled={!selected.size}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
          <strong role="status">{selected.size} selected</strong>
        </div>
      )}
      <div className="held-jobs compute-queue">
        {jobs.map((job) =>
          sessionId ? (
            <div className="held-job" key={job.job_id}>
              <span>
                <strong>{job.document_name}</strong>
                <small>
                  {job.stage.replaceAll("_", " ")} · {job.progress}% —{" "}
                  {job.message}
                </small>
                <span className="job-progress">
                  <i style={{ width: `${job.progress}%` }} />
                </span>
              </span>
            </div>
          ) : (
            <label className="held-job" key={job.job_id}>
              <input
                type="checkbox"
                checked={selected.has(job.job_id)}
                onChange={() => toggle(job.job_id)}
              />
              <span>
                <strong>{job.document_name}</strong>
                <small>
                  {formatBytes(job.size_bytes)} · suggested ceiling{" "}
                  {job.recommended_gpu_minutes} GPU minutes
                </small>
                <small>{job.message}</small>
              </span>
            </label>
          ),
        )}
        {!jobs.length && <small>No documents are waiting for compute.</small>}
      </div>
      {!sessionId && (
        <>
          <div className="limit-heading">
            <strong>Automatic guardrails</strong>
            <small>Calculated from the documents you select.</small>
          </div>
          <div className="compute-limits" aria-live="polite">
            <label>
              <span>Selected documents</span>
              <input type="number" min={0} value={selected.size} readOnly />
            </label>
            <label>
              <span>Estimated GPU minutes</span>
              <input type="number" min={0} value={minutes} readOnly />
            </label>
          </div>
          <p className="guardrail-note">
            Document count and GPU minutes update automatically with the
            selection. Processing stops earlier when the batch finishes.
          </p>
          <button
            className="primary-button full-button"
            type="button"
            disabled={disabled || !selected.size || release.isPending}
            onClick={() => release.mutate()}
          >
            {release.isPending
              ? "Opening compute session…"
              : "Start selected batch"}
          </button>
        </>
      )}
    </section>
  );
}
