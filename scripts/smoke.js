const { spawn } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const checks = [
  ["API HTTP smoke", "apps/api/scripts/smoke.js"],
  ["API WebSocket smoke", "apps/api/scripts/smoke-ws.js"],
  ["Web smoke", "apps/web/scripts/smoke.js"]
];

async function run(label, script) {
  const scriptPath = resolve(root, script);
  process.stdout.write(`\n== ${label} ==\n`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: root,
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  for (const [label, script] of checks) {
    await run(label, script);
  }
  console.log("\nSmoke OK: API HTTP, API WebSocket and web checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
