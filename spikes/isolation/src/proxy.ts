// Minimal forward proxy: forwards only hosts in ALLOWLIST (comma separated), 403 for the rest.
import http from "node:http";
import net from "node:net";
import { connectPort, isAllowed } from "./allowlist.ts";

const allowlist = (process.env.ALLOWLIST ?? "").split(",").filter(Boolean);
const port = Number(process.env.PORT ?? 3128);

const server = http.createServer((req, res) => {
  let target: URL;
  try {
    target = new URL(req.url ?? "");
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  if (!isAllowed(target.host, allowlist)) {
    res.writeHead(403).end("blocked");
    return;
  }
  const upstream = http.request(
    {
      host: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: target.pathname + target.search,
      headers: req.headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => res.headersSent || res.writeHead(502).end("bad gateway"));
  req.pipe(upstream);
});

server.on("connect", (req, socket) => {
  const [host, p] = (req.url ?? "").split(":");
  if (!isAllowed(host ?? "", allowlist)) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const targetPort = connectPort(p);
  if (targetPort === null) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const upstream = net.connect(targetPort, host, () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(port, () => console.log("listening"));
