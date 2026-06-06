import { unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const uploadImageRoot = resolve(process.cwd(), "uploads", "images");

export function uploadedImageFileNameFromUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw || !raw.includes("/uploads/images/")) return null;
  let pathname = raw;
  try {
    pathname = new URL(raw, "http://localhost").pathname;
  } catch {
    pathname = raw.split(/[?#]/)[0];
  }
  const match = pathname.match(/\/uploads\/images\/([a-z0-9-]+\.(?:png|jpg|webp))$/i);
  return match?.[1] || null;
}

export function uploadedImagePath(fileName: string) {
  const path = resolve(uploadImageRoot, fileName);
  const location = relative(uploadImageRoot, path);
  if (!location || location.startsWith("..") || isAbsolute(location)) return null;
  return path;
}

export async function deleteUploadedImageByUrl(value?: string | null) {
  const fileName = uploadedImageFileNameFromUrl(value);
  if (!fileName) return false;
  const path = uploadedImagePath(fileName);
  if (!path) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

export async function deleteUploadedImageIfReplaced(previous?: string | null, next?: string | null) {
  if (!previous || previous === next) return false;
  return deleteUploadedImageByUrl(previous);
}
