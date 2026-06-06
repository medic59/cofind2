import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEV_ACCESS_SECRET = "dev-access-secret";
const DEV_REFRESH_SECRET = "dev-refresh-secret";

type RuntimeEnv = NodeJS.ProcessEnv;

type EnvReport = {
  errors: string[];
  warnings: string[];
};

const requiredAlways = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const;
const requiredInProduction = [
  "PUBLIC_WEB_URL",
  "PUBLIC_API_BASE",
  "MEILISEARCH_HOST",
  "MEILISEARCH_MASTER_KEY",
  "PAYMENT_WEBHOOK_SECRET",
  "MAIL_WEBHOOK_URL"
] as const;

export function loadDotEnv(path = findDotEnv()) {
  if (!path) return false;
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    process.env[key] = parseDotEnvValue(line.slice(separator + 1).trim());
  }
  return true;
}

export function validateRuntimeEnv(env: RuntimeEnv = process.env): EnvReport {
  const production = env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of requiredAlways) {
    if (!stringValue(env[key])) {
      (production ? errors : warnings).push(`${key} is not set`);
    }
  }

  if (production) {
    for (const key of requiredInProduction) {
      if (!stringValue(env[key])) {
        errors.push(`${key} is required in production`);
      }
    }
  }

  const accessSecret = stringValue(env.JWT_ACCESS_SECRET);
  const refreshSecret = stringValue(env.JWT_REFRESH_SECRET);
  const weakSecrets = [
    accessSecret === DEV_ACCESS_SECRET ? "JWT_ACCESS_SECRET uses the dev fallback" : null,
    refreshSecret === DEV_REFRESH_SECRET ? "JWT_REFRESH_SECRET uses the dev fallback" : null,
    accessSecret && accessSecret.length < 32 ? "JWT_ACCESS_SECRET should be at least 32 characters" : null,
    refreshSecret && refreshSecret.length < 32 ? "JWT_REFRESH_SECRET should be at least 32 characters" : null,
    accessSecret && refreshSecret && accessSecret === refreshSecret ? "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ" : null
  ].filter(Boolean) as string[];

  for (const issue of weakSecrets) {
    (production ? errors : warnings).push(issue);
  }

  const origins = parsePublicWebOrigins(env.PUBLIC_WEB_URL);
  if (env.PUBLIC_WEB_URL && origins.length === 0) {
    (production ? errors : warnings).push("PUBLIC_WEB_URL must contain valid http(s) origins");
  }
  if (env.MAIL_WEBHOOK_URL && !isHttpUrl(env.MAIL_WEBHOOK_URL)) {
    (production ? errors : warnings).push("MAIL_WEBHOOK_URL must be a valid http(s) URL");
  }
  if (env.PUBLIC_API_BASE && !isHttpUrl(env.PUBLIC_API_BASE)) {
    (production ? errors : warnings).push("PUBLIC_API_BASE must be a valid http(s) URL");
  }
  if (env.PUBLIC_API_URL && !isHttpUrl(env.PUBLIC_API_URL)) {
    (production ? errors : warnings).push("PUBLIC_API_URL must be a valid http(s) URL");
  }

  if (production && origins.some((origin) => new URL(origin).protocol !== "https:")) {
    errors.push("PUBLIC_WEB_URL must use https in production");
  }
  const publicApiBase = stringValue(env.PUBLIC_API_BASE);
  const publicApiUrl = stringValue(env.PUBLIC_API_URL);
  if (production && publicApiBase && urlProtocol(publicApiBase) !== "https:") {
    errors.push("PUBLIC_API_BASE must use https in production");
  }
  if (production && publicApiUrl && urlProtocol(publicApiUrl) !== "https:") {
    errors.push("PUBLIC_API_URL must use https in production");
  }
  if (publicApiBase && publicApiUrl && normalizeUrl(publicApiBase) !== normalizeUrl(publicApiUrl)) {
    (production ? errors : warnings).push("PUBLIC_API_URL must match PUBLIC_API_BASE when both are set");
  }

  const docsEnabled = env.API_DOCS_ENABLED === "true";
  if (production && docsEnabled) {
    warnings.push("API_DOCS_ENABLED=true exposes Swagger docs in production");
  }

  return { errors, warnings };
}

export function assertRuntimeEnv(env: RuntimeEnv = process.env) {
  const report = validateRuntimeEnv(env);
  for (const warning of report.warnings) {
    console.warn(`[env] ${warning}`);
  }
  if (report.errors.length) {
    throw new Error(`Invalid runtime env:\n- ${report.errors.join("\n- ")}`);
  }
}

export function parsePublicWebOrigins(value?: string) {
  return (value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .filter((origin) => {
      try {
        const url = new URL(origin);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    })
    .map((origin) => new URL(origin).origin);
}

export function isSwaggerEnabled(env: RuntimeEnv = process.env) {
  if (env.API_DOCS_ENABLED === "true") return true;
  if (env.API_DOCS_ENABLED === "false") return false;
  return env.NODE_ENV !== "production";
}

function stringValue(value?: string) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function urlProtocol(value: string) {
  try {
    return new URL(value).protocol;
  } catch {
    return "";
  }
}

function normalizeUrl(value: string) {
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function parseDotEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const unquoted = value.slice(1, -1);
    return value.startsWith('"') ? unquoted.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : unquoted;
  }
  const hashIndex = value.indexOf(" #");
  return (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim();
}

function findDotEnv() {
  let current = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = resolve(current, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}
