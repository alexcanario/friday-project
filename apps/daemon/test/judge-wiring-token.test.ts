import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ComposeOptions } from "../src/compose.ts";
import { memoized, type TokenProviderFactory } from "../src/judge-wiring.ts";

const base = { appId: 3, installationId: 4, privateKeyPath: "/k.pem" };
const make = () => vi.fn<TokenProviderFactory>(() => ({ getToken: async () => "x" }));

describe("memoized", () => {
  it("memoized gives different providers for different permissions", () => {
    const factory = make();
    const providerFor = memoized(factory);
    const write = providerFor({ ...base, permissions: { pull_requests: "write" } });
    const read = providerFor({ ...base, permissions: { pull_requests: "read" } });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(write).not.toBe(read);
  });

  it("memoized reuses the provider for the same permissions", () => {
    const factory = make();
    const providerFor = memoized(factory);
    const a = providerFor({ ...base, permissions: { pull_requests: "write" } });
    const b = providerFor({ ...base, permissions: { pull_requests: "write" } });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    const none = providerFor(base);
    expect(none).not.toBe(a);
  });
});

describe("ComposeOptions.createTokenProvider", () => {
  it("ComposeOptions.createTokenProvider is a TokenProviderFactory", () => {
    expectTypeOf<
      NonNullable<ComposeOptions["createTokenProvider"]>
    >().toEqualTypeOf<TokenProviderFactory>();
    const ignoring: ComposeOptions["createTokenProvider"] = (input: { appId: number }) => ({
      getToken: async () => String(input.appId),
    });
    expect(ignoring).toBeDefined();
    // @ts-expect-error a factory demanding an extra required parameter is rejected
    const extra: ComposeOptions["createTokenProvider"] = (input: unknown, more: string) => ({
      getToken: async () => String(input) + more,
    });
    expect(extra).toBeDefined();
  });
});

describe("judge-wiring source", () => {
  it("judge-wiring comment no longer claims the ComposeOptions shape", () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), "../src/judge-wiring.ts");
    expect(readFileSync(file, "utf8")).not.toContain("same shape as");
  });
});
