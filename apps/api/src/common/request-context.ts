import { randomUUID } from "node:crypto";

// Liveness pings are frequent and uninteresting — keep them out of the logs.
const LOG_SKIP = new Set(["/api/v1/health/live", "/api/v1/health"]);

// Per-request middleware: assign/propagate an X-Request-Id and emit one
// structured JSON log line per request (method, path, status, duration, id).
// The id is also stashed on req.requestId for the exception filter and Sentry.
export function requestContextMiddleware(req: any, res: any, next: () => void) {
  const incoming = req.headers?.["x-request-id"];
  const requestId = typeof incoming === "string" && incoming.trim() ? incoming.trim().slice(0, 200) : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const rawPath = String(req.originalUrl || req.url || "");
    const path = rawPath.split("?")[0];
    if (LOG_SKIP.has(path)) return;
    const status = res.statusCode;
    const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
    const entry = {
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      time: new Date().toISOString(),
      msg: "http_request",
      requestId,
      method: req.method,
      path,
      status,
      durationMs,
      ip: req.ip || req.socket?.remoteAddress
    };
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  });

  next();
}
