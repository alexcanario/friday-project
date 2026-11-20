export class ApiHttpError extends Error {
  readonly status: number;
  constructor(status: number, message = `Falha ao consultar a API: HTTP ${status}`) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

export class ApiRedirectError extends ApiHttpError {
  constructor(status: number) {
    super(status, "Falha ao consultar a API: a resposta foi um redirecionamento e não foi seguida");
    this.name = "ApiRedirectError";
  }
}

export const LOGIN_EXPIRED_MESSAGE =
  "Sessão de login expirada. Recarregue a página para entrar de novo.";

export class ApiInsecureError extends Error {
  constructor() {
    super("O host usa http fora do loopback; o token não foi enviado. Use https://.");
    this.name = "ApiInsecureError";
  }
}

export function classifyHostError(error: unknown): "unauthorized" | "offline" | "error" | "login" {
  if (error instanceof ApiRedirectError) return "login";
  if (error instanceof ApiHttpError) return error.status === 401 ? "unauthorized" : "error";
  if (error instanceof TypeError) return "offline";
  return "error";
}
