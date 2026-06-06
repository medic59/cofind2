import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3000);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    sendText(res, req.method, 405, "Method Not Allowed", { allow: "GET, HEAD" });
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${port}`);
  let pathName = "/";
  try {
    pathName = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, req.method, 400, "Bad Request");
    return;
  }
  const cleanPath = normalize(pathName === "/" ? "/index.html" : pathName);
  const filePath = resolve(join(root, cleanPath));

  if (isOutsideRoot(filePath)) {
    sendText(res, req.method, 403, "Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, assetHeaders(filePath));
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (extname(cleanPath)) {
      sendText(res, req.method, error?.code === "EACCES" ? 403 : 404, "Not Found");
      return;
    }

    const body = await readFile(resolve(root, "index.html"));
    res.writeHead(200, assetHeaders("index.html"));
    res.end(req.method === "HEAD" ? undefined : body);
  }
}).listen(port, () => {
  console.log(`Cofind 2 web is running at http://localhost:${port}`);
});

function securityHeaders(extra = {}) {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; connect-src 'self' http: https: ws: wss:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "SAMEORIGIN",
    ...extra
  };
}

function assetHeaders(filePath) {
  const extension = extname(filePath);
  return securityHeaders({
    "content-type": types[extension] || "text/plain; charset=utf-8",
    "cache-control": extension === ".html" ? "no-store" : "public, max-age=60"
  });
}

function isOutsideRoot(filePath) {
  const relation = relative(root, filePath);
  return relation.startsWith("..") || resolve(filePath) === resolve(root, "..") || relation.includes(":");
}

function sendText(res, method, status, message, extra = {}) {
  res.writeHead(status, securityHeaders({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...extra
  }));
  res.end(method === "HEAD" ? undefined : message);
}
