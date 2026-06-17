import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { HttpException, HttpStatus } from "@nestjs/common";
import { isAiEnabled } from "../../common/system-settings";
import { PrismaService } from "../prisma/prisma.service";
import { getEffectiveAiConfig } from "./ai-config";
import { recordProviderUsage } from "./ai-usage-stats";
import { CreateRpSessionDto } from "./dto";
import { AiCompletionResult, AiMessage, AiProvider } from "./ai.types";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { MockProvider } from "./providers/mock.provider";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.provider";
import { YandexProvider } from "./providers/yandex.provider";

// Order also defines auto-fallback preference when the configured default has no key.
const PROVIDER_ORDER = ["anthropic", "openai", "deepseek", "yandex"];

@Injectable()
export class AiService {
  private readonly mock = new MockProvider();

  constructor(private readonly prisma: PrismaService) {}

  private dailyLimit() {
    const n = Number(process.env.AI_DAILY_LIMIT || 20);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  }

  private rpDailyLimit() {
    const n = Number(process.env.AI_RP_DAILY_LIMIT || 50);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
  }

  // Free (non-premium) players get a smaller daily allowance of AI replies in the
  // co-player game; premium keeps the full rpDailyLimit().
  private rpFreeDailyLimit() {
    const n = Number(process.env.AI_RP_FREE_DAILY_LIMIT || 7);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
  }

  isEnabled() {
    return isAiEnabled(this.prisma);
  }

  // Pick the configured default; fall back to any other configured provider; if
  // nothing has a key, fall back to the mock so the feature is still testable.
  // Config (keys/models/default) is resolved per call from the DB (admin-managed)
  // over env, so changes in the admin panel take effect without a restart.
  async resolveProvider(): Promise<AiProvider> {
    const cfg = await getEffectiveAiConfig(this.prisma);
    const providers: Record<string, AiProvider> = {
      anthropic: new AnthropicProvider(cfg.anthropic),
      openai: new OpenAiCompatibleProvider("openai", cfg.openai),
      deepseek: new OpenAiCompatibleProvider("deepseek", cfg.deepseek),
      yandex: new YandexProvider(cfg.yandex),
    };
    const preferred = (cfg.defaultProvider || "anthropic").toLowerCase();
    const ordered = [preferred, ...PROVIDER_ORDER.filter((p) => p !== preferred)];
    for (const name of ordered) {
      const provider = providers[name];
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

  // Accumulate provider-reported token usage for the owner panel (best-effort).
  private async recordTokens(result: AiCompletionResult) {
    await recordProviderUsage(this.prisma, result.provider, result.usage);
  }

  async status(userId: string) {
    const enabled = await this.isEnabled();
    const limit = this.dailyLimit();
    const used = enabled ? await this.usageCount(userId, "all") : 0;
    return {
      enabled,
      provider: enabled ? (await this.resolveProvider()).name : null,
      dailyLimit: limit,
      remaining: Math.max(0, limit - used),
    };
  }

  private async guard(userId: string, feature: string, limit: number) {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException("AI features are disabled");
    }
    const used = await this.usageCount(userId, feature);
    if (used >= limit) {
      throw new HttpException("Дневной лимит ИИ-запросов исчерпан. Попробуйте завтра.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // RP daily guard with a premium-aware limit: non-premium players are capped at
  // rpFreeDailyLimit() AI replies per day, premium at rpDailyLimit().
  private async guardRp(userId: string) {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException("AI features are disabled");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isPremium: true } });
    const isPremium = Boolean(user?.isPremium);
    const limit = isPremium ? this.rpDailyLimit() : this.rpFreeDailyLimit();
    const used = await this.usageCount(userId, "rp");
    if (used >= limit) {
      throw new HttpException(
        isPremium
          ? "Дневной лимит ответов ИИ-соигрока исчерпан. Попробуйте завтра."
          : `Бесплатно доступно ${limit} ответов ИИ-соигрока в день. Лимит исчерпан — продолжите завтра или оформите премиум.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async generateListingDraft(userId: string, input: { prompt: string; type?: string }) {
    await this.guard(userId, "all", this.dailyLimit());
    const provider = await this.resolveProvider();
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
    await this.recordTokens(result);
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

  // ---- AI co-player (RP) ----

  private buildRpSystemPrompt(s: {
    fandom: string | null;
    character: string | null;
    userRole: string | null;
    style: string | null;
    tempo: string | null;
    setting: string | null;
    boundaries: string | null;
    ageRating: string;
  }) {
    const lines = [
      "Ты — ИИ-партнёр для ролевой игры и совместного письма на платформе Cofind 2.",
      "Веди художественную сцену вместе с пользователем. Всегда отвечай на русском, оставайся в образе, пиши живо и литературно (2–5 абзацев). Не говори и не действуй за персонажа пользователя — оставляй ему инициативу.",
    ];
    if (s.fandom) lines.push(`Сеттинг/фандом: ${s.fandom}.`);
    if (s.character) lines.push(`Твой персонаж: ${s.character}.`);
    if (s.userRole) lines.push(`Персонаж пользователя: ${s.userRole}.`);
    if (s.style) lines.push(`Стиль письма: ${s.style}.`);
    if (s.tempo) lines.push(`Темп: ${s.tempo}.`);
    if (s.setting) lines.push(`Описание сцены: ${s.setting}.`);
    if (s.boundaries) lines.push(`Жёсткие границы — строго соблюдай и никогда не нарушай: ${s.boundaries}.`);
    const adult = s.ageRating === "ADULT" || s.ageRating === "MATURE";
    lines.push(
      adult
        ? "Возрастной рейтинг 18+. Тем не менее строго запрещён любой сексуальный контент с участием несовершеннолетних и реальные инструкции к незаконным/опасным действиям."
        : "Возрастной рейтинг для подростков/всех: не пиши откровенно сексуальный или чрезмерно жестокий контент, держи тон уместным.",
    );
    lines.push("Если пользователь просит нарушить границы или правила — мягко откажись, оставаясь в образе.");
    lines.push("Помни: ты — ИИ, а не реальный человек.");
    return lines.join("\n");
  }

  private async findOwnedSession(userId: string, id: string) {
    const session = await this.prisma.aiRpSession.findUnique({ where: { id } });
    if (!session || session.userId !== userId) throw new NotFoundException("Сессия не найдена");
    return session;
  }

  async listRpSessions(userId: string) {
    return this.prisma.aiRpSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, title: true, fandom: true, character: true, updatedAt: true },
    });
  }

  async getRpSession(userId: string, id: string) {
    const session = await this.findOwnedSession(userId, id);
    const messages = await this.prisma.aiRpMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return { session, messages };
  }

  async createRpSession(userId: string, dto: CreateRpSessionDto) {
    if (!(await this.isEnabled())) throw new ForbiddenException("AI features are disabled");
    const session = await this.prisma.aiRpSession.create({
      data: {
        userId,
        title: dto.title,
        fandom: dto.fandom || null,
        character: dto.character || null,
        userRole: dto.userRole || null,
        style: dto.style || null,
        tempo: dto.tempo || null,
        setting: dto.setting || null,
        boundaries: dto.boundaries || null,
        ageRating: dto.ageRating || "TEEN",
      },
    });
    // Best-effort opening move from the AI to set the scene.
    try {
      await this.guardRp(userId);
      const provider = await this.resolveProvider();
      const result = await provider.complete({
        system: this.buildRpSystemPrompt(session),
        messages: [{ role: "user", content: "Начни сцену: задай атмосферу и сделай первый ход за своего персонажа. Не отвечай за меня." }],
        maxTokens: 800,
        temperature: 0.9,
        timeoutMs: 30_000,
      });
      if (result.text.trim()) {
        await this.prisma.aiRpMessage.create({ data: { sessionId: session.id, role: "assistant", content: result.text.trim() } });
        await this.recordUsage(userId, "rp");
        await this.recordTokens(result);
      }
    } catch {
      // opening is optional — the session is still usable without it
    }
    return this.getRpSession(userId, session.id);
  }

  async sendRpMessage(userId: string, id: string, content: string) {
    await this.guardRp(userId);
    const session = await this.findOwnedSession(userId, id);
    await this.prisma.aiRpMessage.create({ data: { sessionId: id, role: "user", content } });

    const history = await this.prisma.aiRpMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    // Keep the last 20 turns to bound token cost.
    const recent: AiMessage[] = history.slice(-20).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

    const provider = await this.resolveProvider();
    let result;
    try {
      result = await provider.complete({
        system: this.buildRpSystemPrompt(session),
        messages: recent,
        maxTokens: 900,
        temperature: 0.9,
        timeoutMs: 30_000,
      });
    } catch (error: any) {
      throw new ServiceUnavailableException(`ИИ-провайдер недоступен: ${String(error?.message || error).slice(0, 200)}`);
    }

    const reply = await this.prisma.aiRpMessage.create({
      data: { sessionId: id, role: "assistant", content: result.text.trim() || "…" },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    // Touch the session so it sorts to the top of the list (@updatedAt bumps on update).
    await this.prisma.aiRpSession.update({ where: { id }, data: { title: session.title } });
    await this.recordUsage(userId, "rp");
    await this.recordTokens(result);
    return reply;
  }

  async deleteRpSession(userId: string, id: string) {
    await this.findOwnedSession(userId, id);
    await this.prisma.aiRpSession.delete({ where: { id } });
    return { ok: true };
  }
}
