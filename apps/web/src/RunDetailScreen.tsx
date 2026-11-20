import type { HostEntry } from "@friday/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ApiClient } from "./api.ts";
import { queryKeys } from "./query-keys.ts";
import { runDetailState } from "./run-detail-state.ts";
import { RunDetailView } from "./RunDetailView.tsx";

export function RunDetailScreen({
  host,
  project,
  runId,
  clientFor,
}: {
  host: HostEntry;
  project: string;
  runId: string;
  clientFor: (host: HostEntry) => ApiClient;
}) {
  const client = useMemo(() => clientFor(host), [host, clientFor]);
  const run = useQuery({
    queryKey: queryKeys.projectRun(project, runId, host.name),
    queryFn: () => client.fetchRun(project, runId),
    retry: false,
  });
  const review = useQuery({
    queryKey: queryKeys.projectRunReview(project, runId, host.name),
    queryFn: () => client.fetchRunReview(project, runId),
    retry: false,
  });
  return (
    <RunDetailView
      host={host}
      project={project}
      runId={runId}
      state={runDetailState(run, review)}
      run={run.data ?? null}
      review={review.data ?? null}
    />
  );
}
