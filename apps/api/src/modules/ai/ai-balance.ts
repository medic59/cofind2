import { PrismaService } from "../prisma/prisma.service";
import { getEffectiveAiConfig } from "./ai-config";
import { getJson } from "./providers/fetch-json";

// Account balance over the working API key is only exposed by DeepSeek
// (GET /user/balance). Anthropic, OpenAI and YandexGPT keep balance in their
// console / separate billing API, not retrievable with the chat key — we report
// that honestly instead of pretending.
export type BalanceResult = {
  provider: string;
  supported: boolean;     // does this provider expose balance over the API key?
  available: boolean;     // did we actually get a figure?
  reason?: string;        // why not (no key / unsupported / upstream error)
  isAvailable?: boolean;  // provider's own "account usable" flag (DeepSeek)
  balances?: { currency: string; total: string; granted: string; toppedUp: string }[];
  consoleUrl?: string;    // where the owner can check it manually
};

const CONSOLE_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/billing",
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  deepseek: "https://platform.deepseek.com/usage",
  yandex: "https://console.yandex.cloud/billing",
};

export async function fetchProviderBalance(prisma: PrismaService, providerRaw: string): Promise<BalanceResult> {
  const provider = String(providerRaw || "").toLowerCase();
  const consoleUrl = CONSOLE_URLS[provider];

  if (provider !== "deepseek") {
    return {
      provider,
      supported: false,
      available: false,
      reason: "Этот провайдер не отдаёт баланс по API-ключу — проверьте в личном кабинете.",
      consoleUrl,
    };
  }

  const cfg = await getEffectiveAiConfig(prisma);
  const apiKey = cfg.deepseek.apiKey;
  if (!apiKey) {
    return { provider, supported: true, available: false, reason: "Ключ DeepSeek не задан.", consoleUrl };
  }

  // Balance lives at the API origin (no /v1 path): https://api.deepseek.com/user/balance
  let origin = "https://api.deepseek.com";
  try {
    origin = new URL(cfg.deepseek.baseUrl).origin;
  } catch {
    // keep default origin
  }

  try {
    const data = await getJson(`${origin}/user/balance`, { authorization: `Bearer ${apiKey}` });
    const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
    return {
      provider,
      supported: true,
      available: true,
      isAvailable: Boolean(data?.is_available),
      balances: infos.map((b: any) => ({
        currency: String(b?.currency || ""),
        total: String(b?.total_balance ?? ""),
        granted: String(b?.granted_balance ?? ""),
        toppedUp: String(b?.topped_up_balance ?? ""),
      })),
      consoleUrl,
    };
  } catch (error: any) {
    return {
      provider,
      supported: true,
      available: false,
      reason: `Не удалось получить баланс: ${String(error?.message || error).slice(0, 160)}`,
      consoleUrl,
    };
  }
}
