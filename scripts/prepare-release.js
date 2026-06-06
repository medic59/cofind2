const { existsSync, readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const envPath = resolve(process.cwd(), process.argv[2] || "deploy/.env.production");
if (!existsSync(envPath)) {
  console.error(`Production env file not found: ${envPath}`);
  console.error("Copy deploy/.env.production.example to deploy/.env.production and fill real values first.");
  process.exit(1);
}

const env = { ...process.env, ...parseEnv(readFileSync(envPath, "utf8")), NODE_ENV: "production" };
const placeholders = Object.entries(env)
  .filter(([key]) => [
    "POSTGRES_PASSWORD",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "MEILISEARCH_MASTER_KEY",
    "PAYMENT_WEBHOOK_SECRET",
    "MAIL_WEBHOOK_SECRET",
    "PUBLIC_WEB_URL",
    "PUBLIC_API_BASE",
    "MAIL_WEBHOOK_URL"
  ].includes(key))
  .filter(([, value]) => /replace-with|change-me|example\.com/i.test(String(value || "")))
  .map(([key]) => key);

if (placeholders.length) {
  console.error(`Production env still contains placeholders: ${placeholders.join(", ")}`);
  process.exit(1);
}

run("pnpm", ["--filter", "@cofind/web", "build"], env);
run("pnpm", ["release:check"], env);
console.log("Release preparation OK");

function run(command, args, env) {
  const executable = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: false
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    result[key] = parseValue(line.slice(separator + 1).trim());
  }
  return result;
}

function parseValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const unquoted = value.slice(1, -1);
    return value.startsWith('"') ? unquoted.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : unquoted;
  }
  const hashIndex = value.indexOf(" #");
  return (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim();
}
