// Provider-agnostic transactional email. MAIL_PROVIDER selects the transport;
// with "console" (the default when nothing is configured) nothing is delivered —
// the message is logged and captured in-memory for tests/dev. Config-driven, like
// Sentry: drop in real credentials to start sending.
//
//   MAIL_PROVIDER = console | webhook | smtp | resend | postmark
//   MAIL_FROM     = "Cofind 2 <noreply@cofind2.com>"
//   webhook:  MAIL_WEBHOOK_URL (+ MAIL_WEBHOOK_SECRET)
//   resend:   RESEND_API_KEY
//   postmark: POSTMARK_SERVER_TOKEN (+ POSTMARK_MESSAGE_STREAM)
//   smtp:     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE

export type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

// In-memory outbox for the console provider (dev) and tests. Capped ring buffer.
const outbox: Array<TransactionalEmail & { at: string }> = [];
const OUTBOX_LIMIT = 200;

export function capturedEmails(): Array<TransactionalEmail & { at: string }> {
  return outbox.slice();
}
export function clearCapturedEmails() {
  outbox.length = 0;
}
function capture(message: TransactionalEmail) {
  outbox.push({ ...message, at: new Date().toISOString() });
  if (outbox.length > OUTBOX_LIMIT) outbox.splice(0, outbox.length - OUTBOX_LIMIT);
}

function mailFrom() {
  return process.env.MAIL_FROM || "Cofind 2 <noreply@cofind2.com>";
}

function resolveProvider() {
  const explicit = (process.env.MAIL_PROVIDER || "").toLowerCase().trim();
  if (explicit) return explicit;
  if (process.env.MAIL_WEBHOOK_URL) return "webhook";
  return "console";
}

export function mailProvider() {
  return resolveProvider();
}

// Whether new registrations must confirm their e-mail before publishing/DMs.
// Default OFF so the gate never locks out users before real mail delivery is
// configured (the current prod webhook is a placeholder). The owner sets
// EMAIL_VERIFICATION_REQUIRED=true together with a real MAIL_PROVIDER.
export function emailVerificationRequired(): boolean {
  const flag = (process.env.EMAIL_VERIFICATION_REQUIRED || "").toLowerCase().trim();
  return flag === "true" || flag === "1";
}

export async function sendTransactionalEmail(message: TransactionalEmail): Promise<boolean> {
  switch (resolveProvider()) {
    case "resend":
      return sendViaResend(message);
    case "postmark":
      return sendViaPostmark(message);
    case "smtp":
      return sendViaSmtp(message);
    case "webhook":
      return sendViaWebhook(message);
    case "console":
    default:
      return sendViaConsole(message);
  }
}

function sendViaConsole(message: TransactionalEmail): boolean {
  capture(message);
  // Structured line so it is visible in logs but obviously not delivered.
  console.log(JSON.stringify({ level: "info", msg: "mail_console", to: message.to, subject: message.subject }));
  return true;
}

async function sendViaWebhook(message: TransactionalEmail): Promise<boolean> {
  const endpoint = process.env.MAIL_WEBHOOK_URL?.trim();
  if (!endpoint) throw new Error("MAIL_WEBHOOK_URL is required for MAIL_PROVIDER=webhook");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.MAIL_WEBHOOK_SECRET?.trim();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ from: mailFrom(), ...message }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Mail webhook failed: HTTP ${response.status} ${body.slice(0, 160)}`);
  }
  return true;
}

async function sendViaResend(message: TransactionalEmail): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY is required for MAIL_PROVIDER=resend");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: mailFrom(), to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend failed: HTTP ${response.status} ${body.slice(0, 160)}`);
  }
  return true;
}

async function sendViaPostmark(message: TransactionalEmail): Promise<boolean> {
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  if (!token) throw new Error("POSTMARK_SERVER_TOKEN is required for MAIL_PROVIDER=postmark");
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Postmark-Server-Token": token },
    body: JSON.stringify({
      From: mailFrom(),
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM || "outbound"
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Postmark failed: HTTP ${response.status} ${body.slice(0, 160)}`);
  }
  return true;
}

async function sendViaSmtp(message: TransactionalEmail): Promise<boolean> {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error("SMTP_HOST is required for MAIL_PROVIDER=smtp");
  // Lazy require so nodemailer is only loaded when SMTP is actually used.
  const nodemailer = require("nodemailer");
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  await transport.sendMail({ from: mailFrom(), to: message.to, subject: message.subject, text: message.text, html: message.html });
  return true;
}
