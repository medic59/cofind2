import { AiCompletionOptions, AiCompletionResult, AiProvider } from "../ai.types";
import { postJson } from "./fetch-json";

// Covers OpenAI (ChatGPT) and any OpenAI-compatible API (DeepSeek uses the exact
// same /chat/completions shape). Configured per-instance so one class serves both.
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly apiKeyEnv: string,
    private readonly modelEnv: string,
    private readonly defaultModel: string,
    private readonly defaultBaseUrl: string,
    private readonly baseUrlEnv?: string,
  ) {}

  private get apiKey() {
    return process.env[this.apiKeyEnv] || "";
  }

  private get model() {
    return (this.modelEnv && process.env[this.modelEnv]) || this.defaultModel;
  }

  private get baseUrl() {
    return ((this.baseUrlEnv && process.env[this.baseUrlEnv]) || this.defaultBaseUrl).replace(/\/+$/, "");
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const messages = [
      ...(options.system ? [{ role: "system", content: options.system }] : []),
      ...options.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const data = await postJson(
      `${this.baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        messages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      },
      options.timeoutMs,
    );
    const text = data?.choices?.[0]?.message?.content ?? "";
    return { text: String(text || ""), provider: this.name, model: this.model };
  }
}
