import { summarizeRun } from "./src/summarize.ts";

const [messagesFile, canUseToolFile] = process.argv.slice(2);
if (!messagesFile || !canUseToolFile) {
  console.error("uso: node summarize.ts <messages> <can-use-tool>");
  process.exit(2);
}
try {
  console.log(JSON.stringify(summarizeRun(messagesFile, canUseToolFile), null, 2));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
