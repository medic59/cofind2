import { AiCompletionOptions, AiCompletionResult, AiProvider } from "../ai.types";
import { postJson } from "./fetch-json";

// YandexGPT (the model behind Алиса). Useful for RU audiences / data-localization.
// Needs an API key + folder id.
export class YandexProvider implements AiProvider {
  readonly name = "yandex";

  constructor(private readonly config: { apiKey: string; folderId: string; model: string }) {}

  isConfigured() {
    return Boolean(this.config.apiKey && this.config.folderId);
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const messages = [
      ...(options.system ? [{ role: "system", text: options.system }] : []),
      ...options.messages.map((m) => ({ role: m.role, text: m.content })),
    ];
    const modelUri = `gpt://${this.config.folderId}/${this.config.model}`;
    const data = await postJson(
      "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
      { authorization: `Api-Key ${this.config.apiKey}` },
      {
        modelUri,
        completionOptions: {
          temperature: options.temperature ?? 0.7,
          maxTokens: String(options.maxTokens ?? 1024),
        },
        messages,
      },
      options.timeoutMs,
    );
    const text = data?.result?.alternatives?.[0]?.message?.text ?? "";
    const usage = data?.result?.usage;
    const inputTokens = Number(usage?.inputTextTokens) || 0;
    const outputTokens = Number(usage?.completionTokens) || 0;
    const totalTokens = Number(usage?.totalTokens) || inputTokens + outputTokens;
    return {
      text: String(text || ""),
      provider: this.name,
      model: this.config.model,
      usage: { inputTokens, outputTokens, totalTokens },
    };
  }
}
