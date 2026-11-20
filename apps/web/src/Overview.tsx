import type { HostEntry } from "@friday/contracts";
import type { ApiClient } from "./api.ts";
import { HostCard } from "./HostCard.tsx";

export function Overview({
  hosts,
  clientFor,
}: {
  hosts: HostEntry[];
  clientFor: (host: HostEntry) => ApiClient;
}) {
  if (hosts.length === 0) return <p data-view="overview-empty">Nenhum host cadastrado</p>;
  return (
    <section data-view="overview">
      {hosts.map((host) => (
        <HostCard key={host.name} host={host} clientFor={clientFor} />
      ))}
    </section>
  );
}
