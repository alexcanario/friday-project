import { describe, expect, it } from "vitest";
import { ApiHttpError, ApiRedirectError, LOGIN_EXPIRED_MESSAGE } from "../src/api-errors.ts";
import { projectMessage, projectStateOf } from "../src/project-state.ts";
import { runDetailMessage, runDetailState } from "../src/run-detail-state.ts";

const ok = { status: "success" as const };
const failed = (error: unknown) => ({ status: "error" as const, error });
const login = () => failed(new ApiRedirectError(302));

describe("login state", () => {
  it("maps a redirect to login on project and run states with the priority order", () => {
    expect(LOGIN_EXPIRED_MESSAGE).toBe(
      "Sessão de login expirada. Recarregue a página para entrar de novo.",
    );
    expect(projectStateOf(login(), ok)).toBe("login");
    expect(projectMessage("login")).toBe(LOGIN_EXPIRED_MESSAGE);
    expect(projectStateOf(failed(new ApiHttpError(401)), login())).toBe("unauthorized");
    expect(projectStateOf(login(), failed(new TypeError("x")))).toBe("login");
    expect(projectStateOf(failed(new ApiHttpError(500)), login())).toBe("login");

    expect(runDetailState(login(), ok)).toBe("login");
    expect(runDetailMessage("login")).toBe(LOGIN_EXPIRED_MESSAGE);
    expect(runDetailState(failed(new ApiHttpError(401)), login())).toBe("unauthorized");
    expect(runDetailState(login(), failed(new TypeError("x")))).toBe("login");
    expect(runDetailState(failed(new ApiHttpError(404)), login())).toBe("login");
  });
});
