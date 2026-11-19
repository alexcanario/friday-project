import { describe, expect, it } from "vitest";
import { ApiHttpError, classifyHostError } from "../src/api-errors.ts";

describe("host errors", () => {
  it("classifies unauthorized, offline and error", () => {
    expect(classifyHostError(new ApiHttpError(401))).toBe("unauthorized");
    expect(classifyHostError(new ApiHttpError(500))).toBe("error");
    expect(classifyHostError(new TypeError("fetch failed"))).toBe("offline");
    expect(classifyHostError(new Error("x"))).toBe("error");
  });
});
