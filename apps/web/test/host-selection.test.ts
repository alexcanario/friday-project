import { describe, expect, it } from "vitest";
import { runToSearch, selectionFromSearch, selectionToSearch } from "../src/host-selection.ts";

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

  it("reads the run from the URL and omits the key without it", () => {
    expect(selectionFromSearch("?host=vps+1&project=a%2Fb&run=r1", hosts)).toEqual({
      kind: "selected",
      host: { name: "vps 1", baseUrl: "" },
      project: "a/b",
      run: "r1",
    });
    for (const s of ["?host=vps+1&project=a%2Fb", "?host=vps+1&project=a%2Fb&run="]) {
      expect("run" in selectionFromSearch(s, hosts)).toBe(false);
    }
    expect(selectionFromSearch("?host=vps+1&run=r1", hosts)).toEqual({ kind: "none" });
    expect(selectionFromSearch("?host=zzz&project=a%2Fb&run=r1", hosts)).toEqual({
      kind: "unknown-host",
      host: "zzz",
    });
  });

  it("builds the run URL and round-trips it", () => {
    const search = runToSearch("vps 1", "a/b", "r 1");
    expect(search).toBe("?host=vps+1&project=a%2Fb&run=r+1");
    expect(selectionFromSearch(search, hosts)).toMatchObject({ kind: "selected", run: "r 1" });
    expect(selectionToSearch("vps 1", "a/b")).toBe("?host=vps+1&project=a%2Fb");
  });
});
