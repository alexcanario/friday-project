type Env = Record<string, string | undefined>;

const SECRET_ENV_KEYS = ["FRIDAY_AUTHOR_TOKEN", "FRIDAY_JUDGE_TOKEN", "ANTHROPIC_API_KEY"] as const;
const SECRET_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/g,
  /\bghs_[A-Za-z0-9]+/g,
  /sk-ant-[A-Za-z0-9_-]+/g,
];
const MASK = "***";

/** Builds a function that masks token values and known token shapes in log text. */
export function createRedactor(env: Env): (text: string) => string {
  const values = SECRET_ENV_KEYS.map((key) => env[key]).filter(
    (value): value is string => value !== undefined && value !== "",
  );
  return (text) => {
    let out = text;
    for (const value of values) out = out.split(value).join(MASK);
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, MASK);
    return out;
  };
}

/** Returns opts with log wrapped by the redactor; an absent log stays absent. */
export function withRedactedLog<T extends { env: Env; log?: (message: string) => void }>(
  opts: T,
): T {
  const { log } = opts;
  if (log === undefined) return opts;
  const redact = createRedactor(opts.env);
  return { ...opts, log: (message: string) => log(redact(message)) };
}
