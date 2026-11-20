import type { HostEntry } from "@friday/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import type { ApiClient } from "./api.ts";
import { projectStateOf } from "./project-state.ts";
import { ProjectScreenView } from "./ProjectView.tsx";
import { queryKeys } from "./query-keys.ts";

export function ProjectScreen({
  host,
  project,
  clientFor,
  approvals,
}: {
  host: HostEntry;
  project: string;
  clientFor: (host: HostEntry) => ApiClient;
  approvals?: ReactNode;
}) {
  const client = useMemo(() => clientFor(host), [host, clientFor]);
  const issues = useQuery({
    queryKey: queryKeys.projectIssues(project, host.name),
    queryFn: () => client.fetchIssues(project),
    retry: false,
  });
  const runs = useQuery({
    queryKey: queryKeys.projectRuns(project, host.name),
    queryFn: () => client.fetchRuns(project),
    retry: false,
  });
  return (
    <ProjectScreenView
      host={host}
      project={project}
      state={projectStateOf(issues, runs)}
      issues={issues.data ?? []}
      runs={runs.data ?? []}
      approvals={approvals}
    />
  );
}
