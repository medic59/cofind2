import { AiCompletionOptions, AiCompletionResult, AiProvider } from "../ai.types";
import { postJson } from "./fetch-json";

// Claude (Anthropic Messages API). Default provider for Cofind 2.
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";

  private get apiKey() {
    return process.env.ANTHROPIC_API_KEY || "";
  }

  private get model() {
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async complete(options: AiCompletionOptions): Promise<AiCompletionResult> {
    const data = await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
        system: options.system,
        messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
      },
      options.timeoutMs,
    );
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
      : "";
    return { text: String(text || ""), provider: this.name, model: this.model };
  }
}
