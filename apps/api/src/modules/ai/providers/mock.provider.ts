import { AiCompletionOptions, AiCompletionResult, AiProvider } from "../ai.types";

// Deterministic offline provider. Used when the feature is enabled for testing
// but no real API key is configured yet (the chosen rollout: ship behind a flag,
// wire a key later). Lets the whole pipeline run end-to-end without a vendor.
export class MockProvider implements AiProvider {
  readonly name = "mock";

  isConfigured() {
    return true;
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const lastUser = [...options.messages].reverse().find((m) => m.role === "user")?.content || "";
    const wantsJson = /JSON/i.test(options.system || "");
    if (wantsJson) {
      const seed = (lastUser.slice(0, 80).trim() || "Творческий поиск").replace(/\s+/g, " ");
      const text = JSON.stringify({
        title: `Заявка: ${seed}`.slice(0, 140),
        body:
          `Черновик сгенерирован тестовым (mock) ИИ-провайдером. По запросу: «${lastUser.slice(0, 200)}». ` +
          `Опишите тему подробнее, желаемую роль партнёра, темп ответов и границы — и опубликуйте заявку.`,
        suggestedTags: ["образец"],
        suggestedFandoms: [],
        suggestedGenres: ["Приключения"],
      });
      return { text, provider: this.name, model: "mock" };
    }
    return { text: `(mock-ответ) ${lastUser.slice(0, 200)}`, provider: this.name, model: "mock" };
  }
}
