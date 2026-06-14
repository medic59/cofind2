import { AiCompletionOptions, AiCompletionResult, AiProvider } from "../ai.types";
import { postJson } from "./fetch-json";

// YandexGPT (the model behind Алиса). Useful for RU audiences / data-localization.
// Needs YANDEX_API_KEY + YANDEX_FOLDER_ID.
export class YandexProvider implements AiProvider {
  readonly name = "yandex";

  private get apiKey() {
    return process.env.YANDEX_API_KEY || "";
  }

  private get folderId() {
    return process.env.YANDEX_FOLDER_ID || "";
  }

  private get model() {
    return process.env.YANDEX_MODEL || "yandexgpt/latest";
  }

  isConfigured() {
    return Boolean(this.apiKey && this.folderId);
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const messages = [
      ...(options.system ? [{ role: "system", text: options.system }] : []),
      ...options.messages.map((m) => ({ role: m.role, text: m.content })),
    ];
    const modelUri = `gpt://${this.folderId}/${this.model}`;
    const data = await postJson(
      "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
      { authorization: `Api-Key ${this.apiKey}` },
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
    return { text: String(text || ""), provider: this.name, model: this.model };
  }
}
