import { describe, expect, it } from "vitest";
import { ApiHttpError } from "../src/api-errors.ts";
import { runDetailMessage, runDetailState } from "../src/run-detail-state.ts";

const ok = { status: "success" as const };
const pending = { status: "pending" as const };
const failed = (error: unknown) => ({ status: "error" as const, error });

describe("run detail state", () => {
  it("maps query errors to states and messages", () => {
    expect(runDetailState(pending, ok)).toBe("loading");
    expect(runDetailState(ok, pending)).toBe("loading");
    expect(runDetailState(failed(new ApiHttpError(401)), ok)).toBe("unauthorized");
    expect(runDetailState(ok, failed(new ApiHttpError(401)))).toBe("unauthorized");
    expect(runDetailState(failed(new TypeError("x")), ok)).toBe("offline");
    expect(runDetailState(ok, failed(new ApiHttpError(404)))).toBe("not-found");
    expect(runDetailState(failed(new ApiHttpError(404)), ok)).toBe("not-found");
    expect(runDetailState(failed(new ApiHttpError(500)), ok)).toBe("error");
    expect(runDetailState(ok, failed(new Error("x")))).toBe("error");
    expect(runDetailState(ok, ok)).toBe("ready");
    expect(runDetailState(failed(new ApiHttpError(404)), failed(new ApiHttpError(401)))).toBe(
      "unauthorized",
    );
    expect(runDetailState(failed(new ApiHttpError(404)), failed(new TypeError("x")))).toBe(
      "offline",
    );
    expect(runDetailState(failed(new Error("x")), failed(new ApiHttpError(404)))).toBe("not-found");
    expect(runDetailState(failed(new ApiHttpError(500)), pending)).toBe("error");
    expect(runDetailMessage("loading")).toBe("Carregando a run...");
    expect(runDetailMessage("offline")).toBe("Sem conexão com o host.");
    expect(runDetailMessage("unauthorized")).toBe(
      "Token necessário. Informe o token do host na visão geral.",
    );
    expect(runDetailMessage("not-found")).toBe("Esta run não foi encontrada.");
    expect(runDetailMessage("error")).toBe("Não foi possível carregar a run.");
    expect(runDetailMessage("ready")).toBeNull();
  });
});
