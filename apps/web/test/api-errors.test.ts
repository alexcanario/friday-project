import { describe, expect, it } from "vitest";
import {
  ApiHttpError,
  ApiInsecureError,
  ApiRedirectError,
  classifyHostError,
} from "../src/api-errors.ts";

describe("host errors", () => {
  it("classifies login, unauthorized, offline and error", () => {
    expect(classifyHostError(new ApiRedirectError(302))).toBe("login");
    expect(classifyHostError(new ApiInsecureError())).toBe("error");
    expect(new ApiInsecureError().name).toBe("ApiInsecureError");
    expect(new ApiInsecureError()).not.toBeInstanceOf(ApiHttpError);
    expect(new ApiInsecureError().message).toBe(
      "O host usa http fora do loopback; o token não foi enviado. Use https://.",
    );
    expect(classifyHostError(new ApiHttpError(401))).toBe("unauthorized");
    expect(classifyHostError(new ApiHttpError(500))).toBe("error");
    expect(classifyHostError(new TypeError("fetch failed"))).toBe("offline");
    expect(classifyHostError(new Error("x"))).toBe("error");
  });
});
