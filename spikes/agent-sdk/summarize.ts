import { readFileSync } from "node:fs";
import { parseJsonl, summarizeMessages } from "./src/summarize.ts";

const file = process.argv[2];
if (!file) {
  console.error("uso: node summarize.ts <arquivo>");
  process.exit(2);
}
try {
  const summary = summarizeMessages(parseJsonl(readFileSync(file, "utf8")));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
