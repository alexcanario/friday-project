import { describe, expect, it } from "vitest";
import { CONTEXT_AREAS, selectContextPackAreas } from "../src/index.ts";

describe("context pack areas", () => {
  it("selects the context areas from file paths", () => {
    expect(CONTEXT_AREAS).toEqual(["backend", "frontend"]);
    expect(
      selectContextPackAreas(["src/Orders/OrderService.cs", "tests/OrderServiceTests.cs"]),
    ).toEqual(["backend"]);
    expect(selectContextPackAreas(["Pages/Faq.razor"])).toEqual(["frontend"]);
    expect(selectContextPackAreas(["Pages/Faq.razor.cs"])).toEqual(["frontend"]);
    expect(selectContextPackAreas(["Pages/Faq.razor", "src/Orders/OrderService.cs"])).toEqual([
      "backend",
      "frontend",
    ]);
    expect(selectContextPackAreas([])).toEqual([]);
    expect(selectContextPackAreas(["README.md", "docs/a.txt"])).toEqual([]);
  });
});
