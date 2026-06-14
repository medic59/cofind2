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

export interface AiCompletionResult {
  text: string;
  provider: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  // True only when the provider has the credentials it needs to make a call.
  isConfigured(): boolean;
  complete(options: AiCompletionOptions): Promise<AiCompletionResult>;
}
