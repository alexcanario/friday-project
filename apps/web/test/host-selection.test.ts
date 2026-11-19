import { describe, expect, it } from "vitest";
import { selectionFromSearch, selectionToSearch } from "../src/host-selection.ts";

const hosts = [{ name: "vps 1", baseUrl: "" }];

describe("host selection", () => {
  it("round-trips host and project and reports none and unknown host", () => {
    const search = selectionToSearch("vps 1", "alexcanario/friday-project");
    expect(search).toBe("?host=vps+1&project=alexcanario%2Ffriday-project");
    expect(selectionFromSearch(search, hosts)).toEqual({
      kind: "selected",
      host: { name: "vps 1", baseUrl: "" },
      project: "alexcanario/friday-project",
    });
    expect(selectionFromSearch("?host=nao-existe&project=a%2Fb", hosts)).toEqual({
      kind: "unknown-host",
      host: "nao-existe",
    });
    for (const s of ["", "?project=a%2Fb", "?host=vps+1", "?host=zzz"]) {
      expect(selectionFromSearch(s, hosts)).toEqual({ kind: "none" });
    }
  });
});
