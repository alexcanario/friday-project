// Runs inside the container and prints what it managed to read. Uses only Node built-ins.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";

const TIMEOUT = Number(process.env.PROBE_TIMEOUT ?? 3000);

function errorCode(err: unknown): string {
  const code = (err as { code?: string }).code ?? "UNKNOWN";
  // Docker's embedded DNS may answer a missing name with a temporary failure.
  return code === "EAI_AGAIN" ? "ENOTFOUND" : code;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function fsProbe(paths: string[]): void {
  const info: Record<string, { exists: boolean; readable: boolean; content?: string }> = {};
  for (const path of paths) {
    const content = read(path);
    info[path] = { exists: existsSync(path), readable: content !== null };
    if (content !== null) info[path].content = content;
  }
  let etcWrite = true;
  try {
    writeFileSync("/etc/friday-probe", "x");
  } catch {
    etcWrite = false;
  }
  const env = { ...process.env } as Record<string, string>;
  const leaked =
    Object.values(env).some((v) => v.includes("CANARY-")) ||
    Object.values(info).some((p) => p.content?.includes("CANARY-"));
  console.log(
    JSON.stringify({
      worktreeRead: read("/work/hello.txt"),
      uid: process.getuid?.() ?? -1,
      env,
      paths: info,
      etcWrite,
      leaked,
    }),
  );
}

function getProbe(url: string): void {
  const target = new URL(url);
  const proxy = process.env.HTTP_PROXY ? new URL(process.env.HTTP_PROXY) : null;
  const req = http.request({
    host: proxy ? proxy.hostname : target.hostname,
    port: proxy ? proxy.port : target.port || 80,
    method: "GET",
    path: proxy ? url : target.pathname + target.search,
    headers: { host: target.host },
  });
  const fail = (err: unknown) => console.log(JSON.stringify({ ok: false, code: errorCode(err) }));
  req.setTimeout(TIMEOUT, () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
  req.on("error", fail);
  req.on("response", (res) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => console.log(JSON.stringify({ ok: true, status: res.statusCode, body })));
  });
  req.end();
}

function tcpProbe(host: string, port: number): void {
  const socket = net.connect({ host, port });
  const done = (result: object) => {
    socket.destroy();
    console.log(JSON.stringify(result));
  };
  socket.setTimeout(TIMEOUT, () => done({ ok: false, code: "ETIMEDOUT" }));
  socket.on("connect", () => done({ ok: true }));
  socket.on("error", (err) => done({ ok: false, code: errorCode(err) }));
}

const [mode, a, b] = process.argv.slice(2);
if (mode === "fs") fsProbe(JSON.parse(a ?? "[]") as string[]);
else if (mode === "get") getProbe(a as string);
else if (mode === "tcp") tcpProbe(a as string, Number(b));
else {
  console.error("modo desconhecido");
  process.exit(2);
}
