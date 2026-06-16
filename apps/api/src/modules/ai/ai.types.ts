// Provider-agnostic AI abstraction. Concrete providers (Anthropic, OpenAI,
// DeepSeek, YandexGPT, Mock) implement AiProvider; AiService picks one by config
// so the rest of the app never depends on a specific vendor.

export type AiRole = "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiCompletionOptions {
  // System/instruction prompt, passed separately (Anthropic-style); OpenAI-like
  // providers fold it into a leading system message.
  system?: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
  // Hard wall-clock cap for the upstream call.
  timeoutMs?: number;
}

// Token usage reported by the provider for a single completion. All four real
// providers return this; we accumulate it per-provider for the owner panel.
export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiCompletionResult {
  text: string;
  provider: string;
  model: string;
  usage?: AiTokenUsage;
}

export interface AiProvider {
  readonly name: string;
  // True only when the provider has the credentials it needs to make a call.
  isConfigured(): boolean;
  complete(options: AiCompletionOptions): Promise<AiCompletionResult>;
}
