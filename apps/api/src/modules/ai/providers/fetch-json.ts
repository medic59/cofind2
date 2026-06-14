// Small fetch wrapper with a hard timeout and JSON parsing. Node 18+ global
// fetch. Throws a concise error so AiService can map it to a clean 502/timeout.
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 30_000,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`upstream ${response.status}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`upstream returned non-JSON: ${text.slice(0, 200)}`);
    }
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error(`upstream timeout after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
