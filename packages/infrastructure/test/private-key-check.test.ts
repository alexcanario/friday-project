import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertPrivateKeyReadable } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "friday-key-check-"));
const file = join(dir, "key.pem");
writeFileSync(file, "SEGREDO-NAO-PEM");
const message = (field: string, path: string) =>
  `Não foi possível ler a chave privada de ${field} em ${path}.`;

describe("assertPrivateKeyReadable", () => {
  it("accepts a readable regular file", () => {
    expect(() => assertPrivateKeyReadable(file, "pull_requests.author_app")).not.toThrow();
  });

  it("rejects a missing path with the pt-BR message", () => {
    const missing = join(dir, "missing.pem");
    expect(() => assertPrivateKeyReadable(missing, "pull_requests.author_app")).toThrow(
      new Error(message("pull_requests.author_app", missing)),
    );
  });

  it("rejects a directory with the same message", () => {
    expect(() => assertPrivateKeyReadable(dir, "pull_requests.review_app")).toThrow(
      new Error(message("pull_requests.review_app", dir)),
    );
  });

  it("never puts the file content in the error", () => {
    for (const path of [dir, join(dir, "missing.pem")]) {
      try {
        assertPrivateKeyReadable(path, "pull_requests.author_app");
      } catch (error) {
        expect((error as Error).message).not.toContain("SEGREDO-NAO-PEM");
      }
    }
    expect.assertions(2);
  });
});
