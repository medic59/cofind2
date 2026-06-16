import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Symmetric encryption for secrets stored in the DB (e.g. AI provider API keys
// managed from the admin panel). Key is derived from JWT_REFRESH_SECRET, so the
// ciphertext is useless without the server's env. Rotating that secret makes old
// values undecryptable (they read back as "" and must be re-entered) — acceptable
// for credentials an admin can simply paste again.
function encryptionKey() {
  return createHash("sha256").update(process.env.JWT_REFRESH_SECRET || "cofind-ai-secret-fallback").digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(value: string): string {
  try {
    const [version, ivB, tagB, dataB] = String(value).split(":");
    if (version !== "v1" || !ivB || !tagB || !dataB) return "";
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
