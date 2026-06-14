import { ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { HttpException, HttpStatus } from "@nestjs/common";
import { isAiEnabled } from "../../common/system-settings";
import { PrismaService } from "../prisma/prisma.service";
import { AiProvider } from "./ai.types";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { MockProvider } from "./providers/mock.provider";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.provider";
import { YandexProvider } from "./providers/yandex.provider";

// Order also defines auto-fallback preference when the configured default has no key.
const PROVIDER_ORDER = ["anthropic", "openai", "deepseek", "yandex"];

@Injectable()
export class AiService {
  private readonly providers: Record<string, AiProvider>;
  private readonly mock = new MockProvider();

  constructor(private readonly prisma: PrismaService) {
    this.providers = {
      anthropic: new AnthropicProvider(),
      openai: new OpenAiCompatibleProvider("openai", "OPENAI_API_KEY", "OPENAI_MODEL", "gpt-4o-mini", "https://api.openai.com/v1", "OPENAI_BASE_URL"),
      // DeepSeek is OpenAI-compatible — same class, different endpoint/key.
      deepseek: new OpenAiCompatibleProvider("deepseek", "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "deepseek-chat", "https://api.deepseek.com/v1", "DEEPSEEK_BASE_URL"),
      yandex: new YandexProvider(),
    };
  }

  private dailyLimit() {
    const n = Number(process.env.AI_DAILY_LIMIT || 20);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  }

  isEnabled() {
    return isAiEnabled(this.prisma);
  }

  // Pick the configured default; fall back to any other configured provider; if
  // nothing has a key, fall back to the mock so the feature is still testable.
  resolveProvider(): AiProvider {
    const preferred = (process.env.AI_DEFAULT_PROVIDER || "anthropic").toLowerCase();
    const ordered = [preferred, ...PROVIDER_ORDER.filter((p) => p !== preferred)];
    for (const name of ordered) {
      const provider = this.providers[name];
      if (provider?.isConfigured()) return provider;
    }
    return this.mock;
  }

  private today() {
    return new Date().toISOString().slice(0, 10);
  }

  private async usageCount(userId: string, feature: string) {
    const row = await this.prisma.aiUsage.findUnique({
      where: { userId_feature_day: { userId, feature, day: this.today() } },
      select: { count: true },
    });
    return row?.count ?? 0;
  }

  private async recordUsage(userId: string, feature: string) {
    await this.prisma.aiUsage.upsert({
      where: { userId_feature_day: { userId, feature, day: this.today() } },
      create: { userId, feature, day: this.today(), count: 1 },
      update: { count: { increment: 1 } },
    });
  }

  async status(userId: string) {
    const enabled = await this.isEnabled();
    const limit = this.dailyLimit();
    const used = enabled ? await this.usageCount(userId, "all") : 0;
    return {
      enabled,
      provider: enabled ? this.resolveProvider().name : null,
      dailyLimit: limit,
      remaining: Math.max(0, limit - used),
    };
  }

  private async guard(userId: string) {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException("AI features are disabled");
    }
    const used = await this.usageCount(userId, "all");
    if (used >= this.dailyLimit()) {
      throw new HttpException("Дневной лимит ИИ-запросов исчерпан. Попробуйте завтра.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async generateListingDraft(userId: string, input: { prompt: string; type?: string }) {
    await this.guard(userId);
    const provider = this.resolveProvider();
    const system =
      "Ты — помощник творческой платформы Cofind 2 (поиск соавторов, соигроков и творческих партнёров " +
      "для фанфиков, ролевых игр и совместного письма). По короткому запросу автора составь черновик заявки " +
      "на русском языке: ясный, доброжелательный, по делу. Верни СТРОГО валидный JSON без markdown-обёртки, " +
      'формата: {"title": string (6-140 символов), "body": string (понятное описание, 1-3 абзаца, что ищет автор, ' +
      'тема/сеттинг, желаемая роль партнёра, темп и границы), "suggestedTags": string[], "suggestedFandoms": string[], ' +
      '"suggestedGenres": string[]}. Не выдумывай несуществующих фактов; если данных мало — оставь массивы пустыми.';
    const userPrompt = input.type
      ? `Тип заявки: ${input.type}. Запрос автора: ${input.prompt}`
      : input.prompt;

    let result;
    try {
      result = await provider.complete({
        system,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 1200,
        temperature: 0.7,
        timeoutMs: 30_000,
      });
    } catch (error: any) {
      throw new ServiceUnavailableException(`ИИ-провайдер недоступен: ${String(error?.message || error).slice(0, 200)}`);
    }

    await this.recordUsage(userId, "all");
    const draft = this.parseDraft(result.text);
    return { ...draft, provider: result.provider, model: result.model };
  }

  private parseDraft(text: string) {
    const fallback = { title: "", body: String(text || "").trim(), suggestedTags: [] as string[], suggestedFandoms: [] as string[], suggestedGenres: [] as string[] };
    const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return fallback;
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 12) : []);
      return {
        title: typeof obj.title === "string" ? obj.title.slice(0, 140) : "",
        body: typeof obj.body === "string" ? obj.body.slice(0, 4000) : fallback.body,
        suggestedTags: strArr(obj.suggestedTags),
        suggestedFandoms: strArr(obj.suggestedFandoms),
        suggestedGenres: strArr(obj.suggestedGenres),
      };
    } catch {
      return fallback;
    }
  }
}
