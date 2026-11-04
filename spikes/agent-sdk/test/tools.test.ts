import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SPIKE_TOOL_FULL_NAME, createSpikeTools } from "../src/tools.ts";

describe("spike tools", () => {
  it("records calls in process and validates input", async () => {
    const spike = createSpikeTools();
    expect(spike.server.type).toBe("sdk");
    expect(spike.server.name).toBe("spike");
    expect(SPIKE_TOOL_FULL_NAME).toBe("mcp__spike__record");
    const extra = {};
    expect(await spike.record({ note: "a" }, extra)).toEqual({
      content: [{ type: "text", text: "registrado" }],
    });
    await spike.record({ note: "b" }, extra);
    expect(spike.calls).toEqual(["a", "b"]);
    const shape = z.object(spike.recordShape);
    expect(shape.safeParse({}).success).toBe(false);
    expect(shape.safeParse({ note: 1 }).success).toBe(false);
    expect(shape.safeParse({ note: "x" }).success).toBe(true);
  });
});
