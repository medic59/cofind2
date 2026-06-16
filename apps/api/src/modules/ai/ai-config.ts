import { decryptSecret, encryptSecret } from "../../common/secret-box";
import { PrismaService } from "../prisma/prisma.service";

// AI provider config is stored in a single SystemSetting row (JSON). API keys
// are kept encrypted (secret-box) and never returned to clients. Effective config
// = DB value when set, otherwise the matching env var (so env still works as a
// fallback / bootstrap). Managed by OWNER from the admin panel.
export const AI_PROVIDERS_KEY = "ai.providers";

type SettingsClient = Pick<PrismaService, "systemSetting">;
type StoredProvider = { apiKey?: string; model?: string; baseUrl?: string; folderId?: string };
type Stored = {
  defaultProvider?: string;
  anthropic?: StoredProvider;
  openai?: StoredProvider;
  deepseek?: StoredProvider;
  yandex?: StoredProvider;
};

const DEFAULTS = {
  anthropic: { model: "claude-sonnet-4-6" },
  openai: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" },
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
  yandex: { model: "yandexgpt/latest" },
};

export type EffectiveAiConfig = {
  defaultProvider: string;
  anthropic: { apiKey: string; model: string };
  openai: { apiKey: string; model: string; baseUrl: string };
  deepseek: { apiKey: string; model: string; baseUrl: string };
  yandex: { apiKey: string; folderId: string; model: string };
};

async function loadStored(prisma: SettingsClient): Promise<Stored> {
  const row = await prisma.systemSetting.findUnique({ where: { key: AI_PROVIDERS_KEY }, select: { value: true } });
  const value = row?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Stored) : {};
}

const dec = (v?: string) => (v ? decryptSecret(v) : "");

export async function getEffectiveAiConfig(prisma: SettingsClient): Promise<EffectiveAiConfig> {
  const s = await loadStored(prisma);
  return {
    defaultProvider: (s.defaultProvider || process.env.AI_DEFAULT_PROVIDER || "anthropic").toLowerCase(),
    anthropic: {
      apiKey: dec(s.anthropic?.apiKey) || process.env.ANTHROPIC_API_KEY || "",
      model: s.anthropic?.model || process.env.ANTHROPIC_MODEL || DEFAULTS.anthropic.model,
    },
    openai: {
      apiKey: dec(s.openai?.apiKey) || process.env.OPENAI_API_KEY || "",
      model: s.openai?.model || process.env.OPENAI_MODEL || DEFAULTS.openai.model,
      baseUrl: s.openai?.baseUrl || process.env.OPENAI_BASE_URL || DEFAULTS.openai.baseUrl,
    },
    deepseek: {
      apiKey: dec(s.deepseek?.apiKey) || process.env.DEEPSEEK_API_KEY || "",
      model: s.deepseek?.model || process.env.DEEPSEEK_MODEL || DEFAULTS.deepseek.model,
      baseUrl: s.deepseek?.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULTS.deepseek.baseUrl,
    },
    yandex: {
      apiKey: dec(s.yandex?.apiKey) || process.env.YANDEX_API_KEY || "",
      folderId: s.yandex?.folderId || process.env.YANDEX_FOLDER_ID || "",
      model: s.yandex?.model || process.env.YANDEX_MODEL || DEFAULTS.yandex.model,
    },
  };
}

// Non-secret view for the admin UI: whether each provider has a key (DB or env),
// plus the non-secret fields. NEVER returns the actual keys.
export async function getAiConfigView(prisma: SettingsClient) {
  const s = await loadStored(prisma);
  const eff = await getEffectiveAiConfig(prisma);
  return {
    defaultProvider: eff.defaultProvider,
    providers: {
      anthropic: { hasKey: Boolean(s.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY), model: eff.anthropic.model },
      openai: { hasKey: Boolean(s.openai?.apiKey || process.env.OPENAI_API_KEY), model: eff.openai.model, baseUrl: eff.openai.baseUrl },
      deepseek: { hasKey: Boolean(s.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY), model: eff.deepseek.model, baseUrl: eff.deepseek.baseUrl },
      yandex: { hasKey: Boolean(s.yandex?.apiKey || process.env.YANDEX_API_KEY), folderId: eff.yandex.folderId, model: eff.yandex.model },
    },
  };
}

export type AiConfigPatch = {
  defaultProvider?: string;
  anthropic?: Record<string, string>;
  openai?: Record<string, string>;
  deepseek?: Record<string, string>;
  yandex?: Record<string, string>;
};

const VALID_PROVIDERS = ["anthropic", "openai", "deepseek", "yandex"] as const;

export async function updateAiConfig(prisma: SettingsClient, patch: AiConfigPatch) {
  const s = await loadStored(prisma);
  if (patch.defaultProvider && (VALID_PROVIDERS as readonly string[]).includes(patch.defaultProvider.toLowerCase())) {
    s.defaultProvider = patch.defaultProvider.toLowerCase();
  }
  for (const name of VALID_PROVIDERS) {
    const incoming = patch[name];
    if (!incoming || typeof incoming !== "object") continue;
    const current: StoredProvider = { ...(s[name] || {}) };
    if (incoming.apiKey !== undefined) {
      const key = String(incoming.apiKey).trim().slice(0, 500);
      if (key === "") delete current.apiKey; // empty string clears the stored key
      else current.apiKey = encryptSecret(key);
    }
    for (const field of ["model", "baseUrl", "folderId"] as const) {
      if (incoming[field] !== undefined) {
        const val = String(incoming[field]).trim().slice(0, 200);
        if (val === "") delete current[field];
        else current[field] = val;
      }
    }
    s[name] = current;
  }
  await prisma.systemSetting.upsert({
    where: { key: AI_PROVIDERS_KEY },
    create: { key: AI_PROVIDERS_KEY, value: s as object },
    update: { value: s as object },
  });
  return getAiConfigView(prisma);
}
