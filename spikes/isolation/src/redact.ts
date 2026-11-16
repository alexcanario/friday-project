// The probe dumps process.env and the agent may quote it: a key or token never reaches a file.
const API_KEY = new RegExp("sk-" + "ant-[A-Za-z0-9_.-]*", "g");
// `{"X_TOKEN":"value"}`, also with the quotes escaped inside a JSON string: `\"X_TOKEN\":\"value\"`.
const JSON_TOKEN = /(\\?"[A-Za-z0-9_]*_TOKEN\\?"\s*:\s*\\?")[^"\\]*(?=\\?")/g;
// `X_TOKEN=value`, any value up to a space, a quote or a separator.
const ENV_TOKEN = /(\b[A-Za-z0-9_]*_TOKEN=)[^\s"',;\\]+/g;

export function redact(line: string): string {
  return line
    .replace(API_KEY, "[API-KEY-REDACTED]")
    .replace(JSON_TOKEN, "$1[TOKEN-REDACTED]")
    .replace(ENV_TOKEN, "$1[TOKEN-REDACTED]");
}
