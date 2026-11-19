import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHosts } from "../src/hosts-config.ts";

afterEach(() => vi.unstubAllGlobals());

function stub(res: Response) {
  const fn = vi.fn(() => Promise.resolve(res));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("hosts config", () => {
  it("loads the hosts file and rejects 404, bad JSON and a token field", async () => {
    const hosts = [{ name: "local", baseUrl: "" }];
    const fn = stub(new Response(JSON.stringify(hosts)));
    await expect(loadHosts()).resolves.toEqual(hosts);
    expect(fn).toHaveBeenCalledWith("hosts.json");
    const msg = "Lista de hosts inválida.";
    stub(new Response("nope", { status: 404 }));
    await expect(loadHosts()).rejects.toThrow(msg);
    stub(new Response("not json"));
    await expect(loadHosts()).rejects.toThrow(msg);
    stub(new Response(JSON.stringify([{ name: "a", baseUrl: "", token: "x" }])));
    await expect(loadHosts()).rejects.toThrow(msg);
  });
});
