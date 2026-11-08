import { buildNightDigest, type NightReader } from "@friday/application";

const USAGE = "Uso: friday night digest --report-issue <n>\n";

type Result = { stdout: string; stderr: string; code: number };

function parseIssue(args: string[]): number | null {
  const [a, b, flag, value] = args;
  if (args.length !== 4 || a !== "night" || b !== "digest" || flag !== "--report-issue")
    return null;
  return value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

export async function nightDigest(args: string[], deps: { reader: NightReader }): Promise<Result> {
  const issue = parseIssue(args);
  if (issue === null) return { stdout: "", stderr: USAGE, code: 2 };
  try {
    const digest = await buildNightDigest(deps.reader, issue);
    return { stdout: JSON.stringify(digest) + "\n", stderr: "", code: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: `Falha ao ler o GitHub: ${message}\n`, code: 1 };
  }
}

export { USAGE as NIGHT_DIGEST_USAGE };
