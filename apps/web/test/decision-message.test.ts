import { describe, expect, it } from "vitest";
import { decisionMessage } from "../src/decision-message.ts";

describe("decisionMessage", () => {
  it("explains 429 and keeps the other messages", () => {
    const m = (status: number, outcome: string | null) => decisionMessage({ status, outcome });
    expect(m(429, null)).toBe("Muitas tentativas recusadas. Tente de novo em instantes.");
    expect(m(500, null)).toBe("Falha inesperada (HTTP 500).");
    expect(m(401, null)).toBe("Token do painel inválido.");
  });

  it("maps every outcome to its pt-BR message", () => {
    const m = (status: number, outcome: string | null) => decisionMessage({ status, outcome });
    expect(m(200, "merged")).toBe("Aprovado e mesclado.");
    expect(m(200, "denied")).toBe("Pedido rejeitado.");
    expect(m(409, "head_changed")).toBe("O PR mudou depois do pedido; o merge foi recusado.");
    expect(m(409, "expired")).toBe("O pedido expirou.");
    expect(m(409, "already_decided")).toBe("O pedido já foi decidido.");
    expect(m(409, "merge_blocked")).toBe("O GitHub bloqueou o merge.");
    expect(m(404, "unknown")).toBe("Pedido não encontrado.");
    expect(m(401, null)).toBe("Token do painel inválido.");
    expect(m(500, null)).toBe("Falha inesperada (HTTP 500).");
    expect(m(401, "expired")).toBe("O pedido expirou.");
  });
});
