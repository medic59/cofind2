const { readdir, rm, stat } = require("node:fs/promises");
const { resolve } = require("node:path");
const { PrismaClient } = require("@prisma/client");

const root = resolve(__dirname, "..");
const uploadsDir = resolve(root, "uploads/images");
const deleteMode = process.argv.includes("--delete");
const jsonMode = process.argv.includes("--json");

const prisma = new PrismaClient();

async function main() {
  const files = await listFiles();
  const referenced = await referencedUploadFiles();
  const orphanFiles = files.filter((file) => !referenced.has(file.name));
  const report = {
    uploadsDir,
    files: files.length,
    referenced: referenced.size,
    orphans: orphanFiles.length,
    orphanBytes: orphanFiles.reduce((sum, file) => sum + file.size, 0),
    deleteMode
  };

  if (deleteMode) {
    for (const file of orphanFiles) {
      await rm(resolve(uploadsDir, file.name), { force: true });
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ ...report, orphanFiles }, null, 2));
    return;
  }

  console.log(`Upload audit: ${uploadsDir}`);
  console.log(`Files: ${report.files}`);
  console.log(`Referenced local uploads: ${report.referenced}`);
  console.log(`Orphans: ${report.orphans} (${formatBytes(report.orphanBytes)})`);
  if (orphanFiles.length) {
    console.log(`Mode: ${deleteMode ? "deleted orphan files" : "dry-run; pass --delete to remove"}`);
    for (const file of orphanFiles.slice(0, 30)) {
      console.log(`- ${file.name} (${formatBytes(file.size)})`);
    }
    if (orphanFiles.length > 30) {
      console.log(`...and ${orphanFiles.length - 30} more`);
    }
  }
}

async function listFiles() {
  let entries = [];
  try {
    entries = await readdir(uploadsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const info = await stat(resolve(uploadsDir, entry.name));
      return { name: entry.name, size: info.size };
    }));
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

async function referencedUploadFiles() {
  const referenced = new Set();
  const [profiles, preferences, drawings, ads] = await Promise.all([
    prisma.profile.findMany({ select: { avatarUrl: true, coverImageUrl: true } }),
    prisma.userPreference.findMany({ select: { dashboardBackgroundImage: true } }),
    prisma.canvasDrawing.findMany({ select: { imageUrl: true } }),
    prisma.adPlacement.findMany({ select: { imageUrl: true } })
  ]);

  for (const profile of profiles) {
    addUploadFile(referenced, profile.avatarUrl);
    addUploadFile(referenced, profile.coverImageUrl);
  }
  for (const preference of preferences) {
    addUploadFile(referenced, preference.dashboardBackgroundImage);
  }
  for (const drawing of drawings) {
    addUploadFile(referenced, drawing.imageUrl);
  }
  for (const ad of ads) {
    addUploadFile(referenced, ad.imageUrl);
  }
  return referenced;
}

function addUploadFile(referenced, url) {
  if (typeof url !== "string") return;
  const match = url.match(/\/uploads\/images\/([^/?#]+)/);
  if (match?.[1]) referenced.add(decodeURIComponent(match[1]));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
