type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendTransactionalEmail(message: TransactionalEmail) {
  const endpoint = process.env.MAIL_WEBHOOK_URL?.trim();
  if (!endpoint) {
    if (process.env.NODE_ENV !== "production") return false;
    throw new Error("MAIL_WEBHOOK_URL is required to send transactional email");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const secret = process.env.MAIL_WEBHOOK_SECRET?.trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "Cofind <noreply@cofind.local>",
      ...message
    }),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Mail webhook failed: HTTP ${response.status} ${body.slice(0, 160)}`);
  }
  return true;
}
