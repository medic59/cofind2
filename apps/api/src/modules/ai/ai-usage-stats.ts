import { PrismaService } from "../prisma/prisma.service";
import { AiTokenUsage } from "./ai.types";

// Cumulative token usage per provider, kept in a single SystemSetting JSON row.
// Providers don't expose a running "total used" over the normal API key, so we
// accumulate what each completion reports. Read-modify-write inside a tx; under
// this app's low AI volume the race window is negligible (worst case: tiny
// undercount). Surfaced read-only in the OWNER admin panel.
export const AI_USAGE_KEY = "ai.usage";

export type ProviderUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastUsedAt: string | null;
};

type UsageStore = Record<string, ProviderUsage>;

const TRACKED = ["anthropic", "openai", "deepseek", "yandex"] as const;

function emptyUsage(): ProviderUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, lastUsedAt: null };
}

function normalize(value: unknown): UsageStore {
  const store: UsageStore = {};
  const src = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
  for (const name of TRACKED) {
    const u = src[name] || {};
    store[name] = {
      requests: Number(u.requests) || 0,
      inputTokens: Number(u.inputTokens) || 0,
      outputTokens: Number(u.outputTokens) || 0,
      totalTokens: Number(u.totalTokens) || 0,
      lastUsedAt: typeof u.lastUsedAt === "string" ? u.lastUsedAt : null,
    };
  }
  return store;
}

// Read-only view for the admin panel (always returns all tracked providers).
export async function getUsageStats(
  prisma: Pick<PrismaService, "systemSetting">,
): Promise<UsageStore> {
  const row = await prisma.systemSetting.findUnique({ where: { key: AI_USAGE_KEY }, select: { value: true } });
  return normalize(row?.value);
}

// Best-effort accumulation after a successful completion. `provider` is the
// resolved provider name; mock/unknown providers and missing usage are ignored.
export async function recordProviderUsage(
  prisma: PrismaService,
  provider: string,
  usage?: AiTokenUsage,
): Promise<void> {
  if (!usage || !(TRACKED as readonly string[]).includes(provider)) return;
  const at = new Date().toISOString();
  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.systemSetting.findUnique({ where: { key: AI_USAGE_KEY }, select: { value: true } });
      const store = normalize(row?.value);
      const cur = store[provider] || emptyUsage();
      store[provider] = {
        requests: cur.requests + 1,
        inputTokens: cur.inputTokens + (Number(usage.inputTokens) || 0),
        outputTokens: cur.outputTokens + (Number(usage.outputTokens) || 0),
        totalTokens: cur.totalTokens + (Number(usage.totalTokens) || 0),
        lastUsedAt: at,
      };
      await tx.systemSetting.upsert({
        where: { key: AI_USAGE_KEY },
        create: { key: AI_USAGE_KEY, value: store as object },
        update: { value: store as object },
      });
    });
  } catch {
    // usage stats are non-critical — never break the AI request over them
  }
}
