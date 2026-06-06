const { cp, mkdir, writeFile } = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const prismaCli = resolve(root, "node_modules/prisma/build/index.js");
const tscCli = resolve(root, "node_modules/typescript/bin/tsc");

const result = spawnSync(process.execPath, [prismaCli, "validate"], {
  cwd: root,
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error);
}

if (result.status !== 0) {
  process.exit(result.status || 1);
}

const tsc = spawnSync(process.execPath, [tscCli, "-p", "tsconfig.json"], {
  cwd: root,
  stdio: "inherit"
});

if (tsc.error) {
  console.error(tsc.error);
}

if (tsc.status !== 0) {
  process.exit(tsc.status || 1);
}

const dist = resolve(root, "dist");

async function main() {
  await mkdir(dist, { recursive: true });
  await cp(resolve(root, "prisma/schema.prisma"), resolve(dist, "schema.prisma"));
  await writeFile(resolve(dist, "build-info.json"), JSON.stringify({ builtAt: new Date().toISOString() }, null, 2));
  console.log("Built apps/api/dist");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
