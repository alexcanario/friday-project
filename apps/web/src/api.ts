import { healthResponse, type HealthResponse } from "@friday/contracts";

export interface ApiClient {
  fetchHealth(): Promise<HealthResponse>;
}

/** Builds the API client for one base URL; `""` means the same origin as the page. */
export function createApiClient(baseUrl: string): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async fetchHealth() {
      const res = await fetch(`${base}/health`);
      if (!res.ok) throw new Error(`Falha ao consultar a API: HTTP ${res.status}`);
      return healthResponse.parse(await res.json());
    },
  };
}
