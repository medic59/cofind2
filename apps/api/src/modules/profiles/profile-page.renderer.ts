import { documentShell, renderFeedCards } from "../listings/listing-page.renderer";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clip(value: string, limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function absolute(url: string | undefined) {
  return /^https?:\/\//i.test(String(url || "")) ? String(url) : "";
}

function socialUrls(socialLinks: any): string[] {
  const links = socialLinks && typeof socialLinks === "object" ? socialLinks : {};
  const urls: string[] = [];
  if (absolute(links.website)) urls.push(links.website);
  if (links.telegram) urls.push(`https://t.me/${String(links.telegram).replace(/^@/, "")}`);
  if (links.discord) urls.push(String(links.discord));
  return urls.filter((u) => absolute(u));
}

function chips(label: string, items: string[]) {
  const list = [...new Set((items || []).filter(Boolean))].slice(0, 12);
  if (!list.length) return "";
  return `<div class="catalog-chips"><span class="listing-ssr-taxonomy-label">${escapeHtml(label)}</span>${list
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("")}</div>`;
}

function pluralRu(count: number, forms: [string, string, string]) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

const FIELD_LABELS: Array<[string, string]> = [
  ["writingStyle", "Стиль"],
  ["literacyLevel", "Грамотность"],
  ["preferredPostLength", "Длина поста"],
  ["activityLevel", "Темп"],
  ["communicationPreferences", "Общение"]
];

export function renderProfilePage(profile: any, webUrl: string, username: string) {
  const base = (webUrl || "").replace(/\/+$/, "");
  const handle = profile.username || username;
  const canonical = `${base}/profile/${encodeURIComponent(handle)}`;
  const displayName = profile.displayName || handle || "Автор";
  const stats = profile.stats || {};
  const totalListings = Number(stats.listings ?? 0);
  const totalLikes = Number(stats.likes ?? 0);
  const totalResponses = Number(stats.responses ?? 0);
  const listings = Array.isArray(profile.user?.listings) ? profile.user.listings : [];
  const description = clip(profile.bio || `Публичный профиль ${displayName} на Cofind 2: ${totalListings} ${pluralRu(totalListings, ["заявка", "заявки", "заявок"])}, стиль, темп и творческие предпочтения.`, 180);
  const ogImage = absolute(profile.avatarUrl) || `${base}/og-image.png`;
  const socials = socialUrls(profile.socialLinks);

  const fields = FIELD_LABELS
    .filter(([key]) => profile[key])
    .map(([key, label]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(profile[key])}</li>`)
    .join("");

  const listingsBlock = listings.length
    ? `<div class="listing-list">${renderFeedCards(listings)}</div>`
    : `<p class="listing-ssr-muted">Пока нет опубликованных заявок.</p>`;

  const body = `
      <nav class="catalog-breadcrumb"><a href="/">Главная</a> / <span>${escapeHtml(displayName)}</span></nav>
      <article class="listing-ssr-card">
        <p class="listing-ssr-kicker">Профиль автора</p>
        <h1 class="listing-ssr-title">${escapeHtml(displayName)}</h1>
        <p class="listing-ssr-muted">@${escapeHtml(handle)}</p>
        ${profile.bio ? `<p>${escapeHtml(profile.bio)}</p>` : ""}
        <div class="listing-ssr-meta">
          <span><strong>${escapeHtml(totalListings)}</strong> ${escapeHtml(pluralRu(totalListings, ["заявка", "заявки", "заявок"]))}</span>
          <span><strong>${escapeHtml(totalLikes)}</strong> ${escapeHtml(pluralRu(totalLikes, ["лайк", "лайка", "лайков"]))}</span>
          <span><strong>${escapeHtml(totalResponses)}</strong> ${escapeHtml(pluralRu(totalResponses, ["отклик", "отклика", "откликов"]))}</span>
        </div>
        ${fields ? `<section class="listing-ssr-section"><h2>Формат</h2><ul class="listing-ssr-expectations">${fields}</ul></section>` : ""}
        ${chips("Жанры", profile.favoriteGenres)}
        ${chips("Фандомы", profile.favoriteFandoms)}
        ${chips("Персонажи", profile.favoriteCharacters)}
        ${socials.length ? `<p class="listing-ssr-muted">Ссылки: ${socials.map((u) => `<a href="${escapeHtml(u)}" rel="nofollow noopener" target="_blank">${escapeHtml(u.replace(/^https?:\/\//, ""))}</a>`).join(" · ")}</p>` : ""}
        <section class="listing-ssr-section">
          <h2>Опубликованные заявки</h2>
          ${listingsBlock}
        </section>
        <div class="listing-ssr-actions">
          ${profile.user?.canMessage !== false ? `<a class="primary-button" href="/me/inbox?profile=${encodeURIComponent(handle)}">Написать автору</a>` : ""}
          <a class="ghost-button" href="/feed">Лента заявок</a>
        </div>
      </article>`;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: displayName,
    url: canonical,
    description: clip(profile.bio || "", 500),
    ...(absolute(profile.avatarUrl) ? { image: profile.avatarUrl } : {}),
    ...(socials.length ? { sameAs: socials } : {}),
    interactionStatistic: [
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: totalLikes },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/ReplyAction", userInteractionCount: totalResponses }
    ]
  };

  return documentShell({
    title: `${displayName} — профиль автора Cofind 2`,
    description,
    canonical,
    robots: "index,follow",
    ogImage,
    jsonLd,
    body
  });
}

export function renderProfileNotFound(webUrl: string) {
  const base = (webUrl || "").replace(/\/+$/, "");
  const body = `
      <article class="listing-ssr-card listing-ssr-notfound">
        <p class="listing-ssr-kicker">Профиль</p>
        <h1 class="listing-ssr-title">Профиль не найден</h1>
        <p>Такого автора не существует или профиль скрыт.</p>
        <div class="listing-ssr-actions">
          <a class="primary-button" href="/feed">Лента заявок</a>
          <a class="ghost-button" href="/">На главную</a>
        </div>
      </article>`;
  return documentShell({
    title: "Профиль не найден — Cofind 2",
    description: "Запрошенный профиль не найден на Cofind 2.",
    canonical: `${base}/feed`,
    robots: "noindex,nofollow",
    body
  });
}
