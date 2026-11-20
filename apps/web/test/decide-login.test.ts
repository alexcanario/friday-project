import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../src/api.ts";
import { ApiRedirectError, LOGIN_EXPIRED_MESSAGE } from "../src/api-errors.ts";
import { runDecision } from "../src/decide.ts";

function clientRejecting(error: unknown): ApiClient {
  return { postDecision: vi.fn(() => Promise.reject(error)) } as unknown as ApiClient;
}

describe("runDecision login", () => {
  it("answers the login message when the decision is redirected", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => "tok",
      setItem: () => undefined,
    });
    try {
      await expect(
        runDecision(clientRejecting(new ApiRedirectError(302)), "h1", "a1", "approve"),
      ).resolves.toBe(LOGIN_EXPIRED_MESSAGE);
      await expect(
        runDecision(clientRejecting(new Error("x")), "h1", "a1", "approve"),
      ).resolves.toBe("Não foi possível enviar a decisão.");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
