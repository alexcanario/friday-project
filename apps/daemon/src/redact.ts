type Env = Record<string, string | undefined>;

const SECRET_ENV_KEYS = ["FRIDAY_AUTHOR_TOKEN", "FRIDAY_JUDGE_TOKEN", "ANTHROPIC_API_KEY"] as const;
const SECRET_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/g,
  /\bgh[pousr]_[A-Za-z0-9]+/g,
  /sk-ant-[A-Za-z0-9_-]+/g,
];
const MASK = "***";

/** Builds a function that masks token values and known token shapes in log text. */
export function createRedactor(
  env: Env,
  tokenEnvNames: readonly string[] = [],
): (text: string) => string {
  const values = [...SECRET_ENV_KEYS, ...tokenEnvNames]
    .map((key) => env[key])
    .filter((value): value is string => value !== undefined && value !== "");
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
  tokenEnvNames: readonly string[] = [],
): T {
  const { log } = opts;
  if (log === undefined) return opts;
  const redact = createRedactor(opts.env, tokenEnvNames);
  return { ...opts, log: (message: string) => log(redact(message)) };
}

/** The redactor of the Judge context: the env tokens plus the review token env when there is one. */
export function judgeRedactorOf(
  env: Env,
  review: { mode: "env"; tokenEnv: string } | { mode: "app" },
): (text: string) => string {
  return createRedactor(env, review.mode === "env" ? [review.tokenEnv] : []);
}
