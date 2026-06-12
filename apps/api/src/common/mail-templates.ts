import { plural } from "./pluralize";
import type { TransactionalEmail } from "./mail";

// Transactional email templates, kept separate from the send transport.
// Each returns subject/text/html; the caller adds the recipient (`to`).

const BRAND = "#2fbf9f";
const INK = "#0c1a17";

export type EmailBody = Omit<TransactionalEmail, "to">;

function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function button(url: string, label: string) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:${BRAND};color:#05221d;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px">${escapeHtml(label)}</a>`;
}

// Branded HTML shell. `footerHtml` is appended after a divider (e.g. unsubscribe).
function layout(opts: { heading: string; paragraphs: string[]; cta?: { url: string; label: string }; footerHtml?: string }) {
  const paras = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p}</p>`).join("");
  const cta = opts.cta ? `<p style="margin:22px 0">${button(opts.cta.url, opts.cta.label)}</p>` : "";
  const footer = opts.footerHtml
    ? `<hr style="border:none;border-top:1px solid #e3eee9;margin:26px 0 16px" /><p style="margin:0;color:#6b7d77;font-size:13px">${opts.footerHtml}</p>`
    : "";
  return `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f8f6;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${INK}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e3eee9;border-radius:16px;overflow:hidden">
      <tr><td style="padding:22px 28px;border-bottom:1px solid #eef4f1">
        <span style="display:inline-block;width:34px;height:34px;background:${BRAND};color:#05221d;font-weight:700;border-radius:9px;text-align:center;line-height:34px;vertical-align:middle">C2</span>
        <span style="font-weight:700;font-size:18px;margin-left:10px;vertical-align:middle">Cofind 2</span>
      </td></tr>
      <tr><td style="padding:26px 28px">
        <h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(opts.heading)}</h1>
        ${paras}${cta}${footer}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function verificationEmail(params: { displayName: string; verifyUrl: string }): EmailBody {
  const { displayName, verifyUrl } = params;
  return {
    subject: "Подтвердите e-mail — Cofind 2",
    text: [
      `Здравствуйте, ${displayName}!`,
      "Подтвердите адрес, чтобы публиковать заявки и писать в личные сообщения на Cofind 2:",
      verifyUrl,
      "Ссылка действует 24 часа. Если вы не регистрировались на Cofind 2 — просто проигнорируйте письмо."
    ].join("\n\n"),
    html: layout({
      heading: "Подтвердите e-mail",
      paragraphs: [
        `Здравствуйте, <strong>${escapeHtml(displayName)}</strong>!`,
        "Подтвердите адрес, чтобы публиковать заявки и писать в личные сообщения на Cofind 2.",
        "Ссылка действует 24 часа."
      ],
      cta: { url: verifyUrl, label: "Подтвердить e-mail" },
      footerHtml: "Если вы не регистрировались на Cofind 2 — просто проигнорируйте это письмо."
    })
  };
}

const RESPONSE_FORMS: [string, string, string] = ["новый отклик", "новых отклика", "новых откликов"];
const MESSAGE_FORMS: [string, string, string] = ["новое сообщение", "новых сообщения", "новых сообщений"];

function unsubscribeFooter(unsubscribeUrl: string, what: string) {
  return `Вы получили это письмо, потому что включены уведомления о ${what} на Cofind 2. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7d77">Отписаться</a> или изменить настройки в личном кабинете.`;
}

export function responseDigestEmail(params: { count: number; listingsUrl: string; unsubscribeUrl: string }): EmailBody {
  const { count, listingsUrl, unsubscribeUrl } = params;
  const phrase = plural(count, RESPONSE_FORMS); // "3 новых отклика"
  return {
    subject: `У вас ${phrase} на Cofind 2`,
    text: [
      `На ваши заявки пришло ${phrase}.`,
      `Посмотреть отклики: ${listingsUrl}`,
      `Отписаться от таких писем: ${unsubscribeUrl}`
    ].join("\n\n"),
    html: layout({
      heading: `У вас ${escapeHtml(phrase)}`,
      paragraphs: ["На ваши заявки пришли новые отклики. Откройте, чтобы ответить авторам."],
      cta: { url: listingsUrl, label: "Смотреть отклики" },
      footerHtml: unsubscribeFooter(unsubscribeUrl, "новых откликах")
    })
  };
}

export function messageDigestEmail(params: { count: number; inboxUrl: string; unsubscribeUrl: string }): EmailBody {
  const { count, inboxUrl, unsubscribeUrl } = params;
  const phrase = plural(count, MESSAGE_FORMS); // "2 новых сообщения"
  return {
    subject: `У вас ${phrase} на Cofind 2`,
    text: [
      `Вам пришло ${phrase} в личные диалоги.`,
      `Открыть сообщения: ${inboxUrl}`,
      `Отписаться от таких писем: ${unsubscribeUrl}`
    ].join("\n\n"),
    html: layout({
      heading: `У вас ${escapeHtml(phrase)}`,
      paragraphs: ["Вам пришли новые личные сообщения. Откройте диалоги, чтобы ответить."],
      cta: { url: inboxUrl, label: "Открыть сообщения" },
      footerHtml: unsubscribeFooter(unsubscribeUrl, "новых сообщениях")
    })
  };
}
