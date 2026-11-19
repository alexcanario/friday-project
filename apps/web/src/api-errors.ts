export class ApiHttpError extends Error {
  readonly status: number;
  constructor(status: number, message = `Falha ao consultar a API: HTTP ${status}`) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

export function classifyHostError(error: unknown): "unauthorized" | "offline" | "error" {
  if (error instanceof ApiHttpError) return error.status === 401 ? "unauthorized" : "error";
  if (error instanceof TypeError) return "offline";
  return "error";
}
