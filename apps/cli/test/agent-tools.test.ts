import { describe, expect, it } from "vitest";
import { readText } from "./helpers.ts";

const allowedTools = new Set(["Read", "Glob", "Grep"]);

function frontmatterLines(markdown: string): string[] | null {
  const lines = markdown.split(/\r?\n/);
  const first = lines.indexOf("---");
  if (first === -1) return null;
  const second = lines.indexOf("---", first + 1);
  if (second === -1) return null;
  return lines.slice(first + 1, second);
}

function isReadOnlyTools(text: string): boolean {
  const front = frontmatterLines(text);
  if (front === null) return false;
  const tools = front.filter((l) => l.startsWith("tools:"));
  if (tools.length !== 1) return false;
  const items = tools[0]!.slice("tools:".length).trim().split(", ");
  if (!items.includes("Read")) return false;
  return items.every((i) => allowedTools.has(i) || i.startsWith("mcp__friday__"));
}

function bodyOf(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const first = lines.indexOf("---");
  const second = lines.indexOf("---", first + 1);
  return lines.slice(second + 1).join("\n");
}

const agents = ["qa", "judge", "judge-strong", "refiner", "refine-reviewer"] as const;
const agentText = (name: string): string => readText(`.claude/agents/${name}.md`);

const forbidden = [/\bgh\b/, /\bBash\b/, /api repos\//, /per_page/, /--paginate/];

const entryPhrase: Record<string, string> = {
  qa: "The main session passes in the prompt: the issue body, the PR diff, the inline review comments of the PR and the check runs of the head SHA. The working directory is checked out at that head SHA.",
  judge:
    "The main session passes in the prompt: the issue body, the PR labels, the QA JSON, the PR diff, the inline review comments of the PR and the check runs of the head SHA. The working directory is checked out at that head SHA.",
  refiner:
    "The main session passes in the prompt: the issue number, the issue body, the issue labels, the bodies and the open or closed state of the issues it names and, on a second pass, the findings. The working directory is checked out at origin/develop.",
  "refine-reviewer":
    "The main session passes in the prompt: the issue number, the proposed body, and the bodies and the open or closed state of the issues it names. The working directory is checked out at origin/develop.",
};

const verifyCheckRuns =
  "You cannot run commands or tests. Verify with the check runs of the head SHA passed in the prompt and by reading the tests and the code in the checkout.";
const verifyReading =
  "You cannot run commands. Verify by reading the files in the checkout and the issue bodies passed in the prompt.";

describe("reader agents without Bash", () => {
  it("five reader agents declare read-only tools without Bash", () => {
    for (const name of agents) {
      const text = agentText(name);
      const front = frontmatterLines(text) ?? [];
      const tools = front.filter((l) => l.startsWith("tools:"));
      expect(tools, name).toHaveLength(1);
      expect(isReadOnlyTools(text), name).toBe(true);
      for (const tool of ["Read", "Glob", "Grep"]) expect(tools[0], name).toContain(tool);
      expect(tools[0], name).not.toContain("Bash");
    }
  });

  it("isReadOnlyTools accepts read-only lines and rejects Bash, Edit, Write, missing, duplicated and no frontmatter", () => {
    const wrap = (...fm: string[]): string => ["---", ...fm, "---", "body"].join("\n");
    const ok = ["tools: Read, Glob, Grep", "tools: Read, Glob, Grep, mcp__friday__qa_report"];
    for (const line of ok) expect(isReadOnlyTools(wrap(line)), line).toBe(true);
    expect(isReadOnlyTools(wrap(ok[0]!).replace(/\n/g, "\r\n"))).toBe(true);
    const bad = [
      "tools: []",
      "tools: Glob, Grep",
      "tools: Read, Glob, Grep, Bash",
      "tools: Read, Glob, Grep, Bash(gh api:*)",
      "tools: Read, Glob, Grep, Edit",
      "tools: Read, Glob, Grep, Write",
      "tools: Read, Glob, Grep, WebFetch",
      "tools: Read, Glob, Grep, Task",
      "tools: Read, Glob, Grep, Task(implementer)",
    ];
    for (const line of bad) expect(isReadOnlyTools(wrap(line)), line).toBe(false);
    expect(isReadOnlyTools("tools: Read, Glob, Grep\nbody")).toBe(false);
    expect(isReadOnlyTools(wrap("name: x"))).toBe(false);
    expect(isReadOnlyTools(wrap(ok[0]!, ok[0]!))).toBe(false);
    const inBody = ["---", "name: x", "---", "tools: Read, Glob, Grep, Bash"].join("\n");
    expect(isReadOnlyTools(inBody)).toBe(false);
  });

  it("reader agents keep name, model and the risk rule in the description", () => {
    const models: Record<string, string> = {
      qa: "sonnet",
      judge: "sonnet",
      "judge-strong": "opus",
      refiner: "sonnet",
      "refine-reviewer": "opus",
    };
    for (const name of agents) {
      const lines = agentText(name).split(/\r?\n/);
      expect(lines, name).toContain(`name: ${name}`);
      expect(lines, name).toContain(`model: ${models[name]}`);
    }
    for (const name of ["judge", "judge-strong"]) {
      expect(agentText(name).split(/\r?\n/)[2], name).toContain("no declared risk");
    }
  });

  it("reader agent bodies have no gh, Bash or API call and the detector catches one", () => {
    const sample = "run gh api repos/x/y/issues";
    expect(forbidden.some((re) => re.test(sample))).toBe(true);
    for (const name of agents) {
      const body = bodyOf(agentText(name));
      for (const re of forbidden) expect(body, `${name} ${re}`).not.toMatch(re);
    }
  });

  it("each reader body states what the main session passes and judge-strong inherits it from judge.md", () => {
    for (const [name, phrase] of Object.entries(entryPhrase)) {
      expect(bodyOf(agentText(name)), name).toContain(phrase);
    }
    expect(bodyOf(agentText("judge-strong"))).toContain("judge.md");
    expect(bodyOf(agentText("judge"))).toContain(entryPhrase.judge);
    expect(bodyOf("---\nname: x\n---\nno phrase")).not.toContain(entryPhrase.qa);
  });

  it("each reader body states how it verifies without commands", () => {
    for (const name of ["qa", "judge"])
      expect(bodyOf(agentText(name)), name).toContain(verifyCheckRuns);
    const refiner = bodyOf(agentText("refiner"));
    expect(refiner).toContain(verifyReading);
    expect(refiner).toContain(
      "If you need an issue that was not passed, name it in the findings so the main session reads it for the reviewer.",
    );
    const reviewer = bodyOf(agentText("refine-reviewer"));
    expect(reviewer).toContain(verifyReading);
    expect(reviewer).not.toContain("run the install");
  });
});

const commonRule =
  '- A sessão principal lê com `gh api` e passa no prompt do subagente tudo o que ele precisa: `refiner` e `refine-reviewer` recebem o corpo e as labels da issue, os corpos e o estado (aberta ou fechada) das issues que ela cita, com o checkout em `origin/develop` (`git fetch origin && git checkout --detach origin/develop`); `qa`, `judge` e `judge-strong` recebem o corpo da issue, o diff do PR, os check runs do `head_sha` e todos os comentários de revisão inline do PR, de qualquer commit, com o checkout nesse `head_sha` (`git fetch origin && git checkout --detach <head_sha>`); o `judge` e o `judge-strong` recebem também o JSON do QA e as labels do PR. Os comentários inline vêm de `gh api "repos/alexcanario/friday-project/pulls/<pr>/comments?per_page=100&page=<p>"`, repetido com `<p>` = 1, 2, ... enquanto a página trouxer 100 itens; nunca `--paginate`. Esses cinco agentes não têm `Bash` e não rodam testes: verificam pelos check runs e lendo o checkout.';

function section(text: string, heading: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("night docs for the reader agents", () => {
  it("night.md states what the main session passes, the checkout command and the comments pagination", () => {
    const night = readText("docs/night.md");
    const common = section(night, "## Regras comuns (todas as fases)").split("\n");
    expect(common).toContain(commonRule);
    expect(commonRule).toContain("pulls/<pr>/comments?per_page=100&page=<p>");
    expect(commonRule).toContain("nunca");
    expect(commonRule).toContain("--paginate");
    const lines = night.split(/\r?\n/);
    expect(night).toContain(
      "A sessão principal só orquestra: não analisa código nem diff, só os repassa ao subagente.",
    );
    expect(night).not.toContain(
      "A sessão principal só orquestra: não lê código nem diff ela mesma.",
    );
    expect(night).not.toContain(
      "- Cada subagente recebe só o número da issue/PR; ele lê o que a issue lista. Nada de explorar o repositório inteiro.",
    );
    expect(lines).toContain(
      "- Cada subagente recebe no prompt só o que a regra comum lista (corpo e labels, diff, check runs, comentários); ele lê no checkout só o que a issue lista. Nada de explorar o repositório inteiro.",
    );
  });

  it("night-prompts phases A and C state the inputs and a block without it fails", () => {
    const phrase =
      "Pass each subagent its inputs in the prompt: `refiner`, `refine-reviewer`, `qa`, `judge` and `judge-strong` have no Bash.";
    const prompts = readText("docs/night-prompts.md");
    const block = (text: string, title: string): string => {
      const lines = text.split(/\r?\n/);
      const start = lines.findIndex((l) => l.startsWith(`## ${title}`));
      if (start === -1) return "";
      const rest = lines.slice(start + 1);
      const end = rest.findIndex((l) => l.startsWith("## "));
      return (end === -1 ? rest : rest.slice(0, end)).join("\n");
    };
    for (const title of ["Friday · Noite A", "Friday · Noite C"]) {
      expect(block(prompts, title), title).toContain(phrase);
    }
    expect(block(prompts, "Friday · Noite B")).not.toContain(phrase);
    expect(block("## Friday · Noite A\nsem a frase", "Friday · Noite A")).not.toContain(phrase);
    expect(prompts).toContain(
      "Delegate to the `qa`, `judge` or `judge-strong`, `implementer` (fixes) and `reporter` subagents. The `reporter` has no tools: you run the digest, create the suggestion issues and post the report.",
    );
  });

  it("changed files stay within 300 lines", () => {
    const files = [
      ...agents.map((a) => `.claude/agents/${a}.md`),
      "docs/night.md",
      "docs/night-prompts.md",
    ];
    for (const file of files) {
      expect(readText(file).split(/\r?\n/).length, file).toBeLessThanOrEqual(300);
    }
  });
});
