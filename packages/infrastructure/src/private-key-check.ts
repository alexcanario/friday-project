import { accessSync, constants, statSync } from "node:fs";

/** Fails closed when the App private key is missing, not a regular file or unreadable; never reads it. */
export function assertPrivateKeyReadable(path: string, field: string): void {
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
    accessSync(path, constants.R_OK);
  } catch {
    throw new Error(`Não foi possível ler a chave privada de ${field} em ${path}.`);
  }
}
