import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ConnectionState } from "./connection-state.ts";
import { subscribeLiveEvents } from "./live-events.ts";

export function useLiveEvents(
  baseUrl: string,
  project: string | undefined,
  onState?: (state: ConnectionState) => void,
): void {
  const queryClient = useQueryClient();
  useEffect(
    () => subscribeLiveEvents({ baseUrl, project, queryClient, onState }),
    [baseUrl, project, queryClient, onState],
  );
}
