import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "./api.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { connectionStateOf } from "./connection-state.ts";

export function App({ client }: { client: ApiClient }) {
  const query = useQuery({ queryKey: ["health"], queryFn: () => client.fetchHealth() });
  return (
    <main>
      <h1>Friday</h1>
      <ConnectionStatus state={connectionStateOf(query.status)} />
    </main>
  );
}
