import { describe, expect, it } from "vitest";
import { ApiHttpError } from "../src/api-errors.ts";
import { projectMessage, projectStateOf } from "../src/project-state.ts";

describe("project state", () => {
  it("maps query parts to the project state with error over loading", () => {
    const err = (error: unknown) => ({ status: "error", error }) as const;
    expect(projectStateOf({ status: "pending" }, { status: "pending" })).toBe("loading");
    expect(projectStateOf({ status: "success" }, { status: "success" })).toBe("ready");
    expect(projectStateOf(err(new ApiHttpError(401)), { status: "pending" })).toBe("unauthorized");
    expect(projectStateOf(err(new TypeError("x")), { status: "success" })).toBe("offline");
    expect(projectStateOf(err(new ApiHttpError(500)), { status: "success" })).toBe("error");
    expect(projectStateOf(err(new ApiHttpError(500)), err(new ApiHttpError(401)))).toBe(
      "unauthorized",
    );
  });

  it("projectMessage maps each state", () => {
    expect(projectMessage("loading")).toBe("Carregando issues e runs...");
    expect(projectMessage("offline")).toBe("Sem conexão com o host.");
    expect(projectMessage("unauthorized")).toBe(
      "Token necessário. Informe o token do host na visão geral.",
    );
    expect(projectMessage("error")).toBe("Não foi possível carregar issues e runs.");
    expect(projectMessage("ready")).toBeNull();
  });
});
