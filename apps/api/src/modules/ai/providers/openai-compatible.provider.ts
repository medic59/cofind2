import { AiCompletionOptions, AiCompletionResult, AiProvider } from "../ai.types";
import { postJson } from "./fetch-json";

// Covers OpenAI (ChatGPT) and any OpenAI-compatible API (DeepSeek uses the exact
// same /chat/completions shape). Configured per-instance so one class serves both.
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly config: { apiKey: string; model: string; baseUrl: string },
  ) {}

  isConfigured() {
    return Boolean(this.config.apiKey);
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const messages = [
      ...(options.system ? [{ role: "system", content: options.system }] : []),
      ...options.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const data = await postJson(
      `${baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.config.apiKey}` },
      {
        model: this.config.model,
        messages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      },
      options.timeoutMs,
    );
    const text = data?.choices?.[0]?.message?.content ?? "";
    const inputTokens = Number(data?.usage?.prompt_tokens) || 0;
    const outputTokens = Number(data?.usage?.completion_tokens) || 0;
    const totalTokens = Number(data?.usage?.total_tokens) || inputTokens + outputTokens;
    return {
      text: String(text || ""),
      provider: this.name,
      model: this.config.model,
      usage: { inputTokens, outputTokens, totalTokens },
    };
  }
}
