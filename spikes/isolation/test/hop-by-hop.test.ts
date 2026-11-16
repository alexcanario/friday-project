import { describe, expect, it } from "vitest";
import { stripHopByHop } from "../src/hop-by-hop.ts";

describe("hop-by-hop", () => {
  it("stripHopByHop removes hop-by-hop headers and the ones named in connection", () => {
    const input = {
      connection: "x-foo, X-Bar",
      "keep-alive": "timeout=5",
      "proxy-authenticate": "x",
      "proxy-authorization": "y",
      "proxy-connection": "keep-alive",
      te: "trailers",
      trailer: "t",
      upgrade: "websocket",
      "x-foo": "1",
      "x-bar": "2",
      host: "a.test",
      "content-type": "text/plain",
      "x-keep": "3",
    };
    const out = stripHopByHop(input);
    expect(out).toEqual({ host: "a.test", "content-type": "text/plain", "x-keep": "3" });
    expect(out).not.toBe(input);
    expect(input.connection).toBe("x-foo, X-Bar");
  });

  it("accepts connection as an array of values", () => {
    const out = stripHopByHop({ connection: ["x-a", " X-B "], "x-a": "1", "x-b": "2", "x-keep": "3" } as never);
    expect(out).toEqual({ "x-keep": "3" });
  });
});
