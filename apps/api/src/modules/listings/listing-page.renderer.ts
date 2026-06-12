import { pluralize } from "../../common/pluralize";
import { sanitizeRichText, stripRichText } from "../../common/rich-text";

const TYPE_LABELS: Record<string, string> = {
  COAUTHOR_SEARCH: "Соавтор",
  ROLEPLAY_SEARCH: "Соигрок",
  CHARACTER_SEARCH: "Персонаж",
  TEAM_SEARCH: "Команда",
  PLOT_SEARCH: "Сюжет",
  BETA_READER_SEARCH: "Бета-ридер",
  PROJECT_SEARCH: "Проект",
  ARTIST_SEARCH: "Художник",
  EDITOR_SEARCH: "Редактор",
  TRANSLATOR_SEARCH: "Переводчик"
};

const RATING_LABELS: Record<string, string> = {
  EVERYONE: "Для всех",
  TEEN: "Teen",
  MATURE: "Mature",
  ADULT: "18+"
};

function typeLabel(value?: string) {
  return (value && TYPE_LABELS[value]) || value || "Заявка";
}

function ratingLabel(value?: string) {
  return (value && RATING_LABELS[value]) || value || "Рейтинг не указан";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clip(value: string, limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function relationNames(items: any[] | undefined, key: string): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((entry) => entry?.[key]?.name || entry?.name)
    .filter((name): name is string => Boolean(name));
}

function expectations(meta: any): string[] {
  if (!meta) return [];
  return [
    meta.postLengthExpectation && `Длина поста: ${meta.postLengthExpectation}`,
    meta.activityExpectation && `Темп: ${meta.activityExpectation}`,
    meta.grammarExpectation && `Грамотность: ${meta.grammarExpectation}`,
    meta.communicationFormat && `Формат связи: ${meta.communicationFormat}`,
    meta.expectedDuration && `Длительность: ${meta.expectedDuration}`,
    meta.collaborationRules,
    meta.hardLimits && `Границы: ${meta.hardLimits}`,
    meta.softPreferences && `Предпочтения: ${meta.softPreferences}`
  ].filter((value): value is string => Boolean(value));
}

export function documentShell(options: {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogImage?: string;
  ogImageWidth?: number;
  ogImageHeight?: number;
  jsonLd?: object;
  body: string;
}) {
  const { title, description, canonical, robots, ogImage, ogImageWidth, ogImageHeight, jsonLd, body } = options;
  const ogImageDims = ogImage && ogImageWidth && ogImageHeight
    ? `\n    <meta property="og:image:width" content="${ogImageWidth}" />\n    <meta property="og:image:height" content="${ogImageHeight}" />`
    : "";
  const ogImageTag = ogImage ? `\n    <meta property="og:image" content="${escapeHtml(ogImage)}" />${ogImageDims}` : "";
  const twitterImageTag = ogImage ? `\n    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />` : "";
  const jsonLdTag = jsonLd
    ? `\n    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`
    : "";
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${escapeHtml(robots)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />${ogImageTag}
    <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />${twitterImageTag}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />${jsonLdTag}
  </head>
  <body class="listing-ssr-page">
    <header class="listing-ssr-topbar">
      <a class="listing-ssr-brand" href="/">Cofind 2</a>
      <nav class="listing-ssr-nav" aria-label="Основная навигация">
        <a href="/feed">Заявки</a>
        <a href="/help">Как это работает</a>
        <a href="/rules">Правила</a>
        <a href="/chat">Чат</a>
        <a class="ghost-button" href="/auth">Войти</a>
        <a class="primary-button" href="/me/listings/new">Создать заявку</a>
      </nav>
    </header>
    <main class="listing-ssr-main" id="main-content">
${body}
    </main>
    <footer class="site-footer">
      <nav class="footer-links" aria-label="Дополнительные ссылки">
        <a href="/help">Как это работает</a>
        <a href="/rules">Правила</a>
        <a href="/privacy">Приватность</a>
        <a href="/contacts">Контакты</a>
      </nav>
      <p class="footer-copy">© 2026 Cofind 2</p>
    </footer>
  </body>
</html>
`;
}

export function renderListingPage(listing: any, webUrl: string, slug: string) {
  const base = (webUrl || "").replace(/\/+$/, "");
  const canonicalSlug = listing.slug || slug;
  const canonical = `${base}/listings/${encodeURIComponent(canonicalSlug)}`;
  const profile = listing.author?.profile || {};
  const authorName = profile.displayName || profile.username || "Автор";
  const authorUsername = profile.username || "";
  const isOpen = listing.status !== "CLOSED";

  const plainBody = stripRichText(listing.body);
  const description = clip(`${authorName}: ${plainBody}`, 180);
  const bodyHtml = sanitizeRichText(listing.body);

  const tags = relationNames(listing.tags, "tag");
  const genres = relationNames(listing.genres, "genre");
  const fandoms = relationNames(listing.fandoms, "fandom");
  const characters = relationNames(listing.characters, "character");
  const expectationItems = expectations(listing.meta);

  const responses = Number(listing.responses ?? listing._count?.responses ?? 0);
  const likes = Number(listing.likes ?? 0);
  // Dynamic 1200x630 OG card generated by the API (served via nginx at
  // /listings/<slug>/og.png), with a static brand fallback baked into the route.
  const ogImage = `${base}/listings/${encodeURIComponent(canonicalSlug)}/og.png`;

  const taxonomyBlock = (label: string, items: string[]) =>
    items.length
      ? `
        <div class="listing-ssr-taxonomy">
          <span class="listing-ssr-taxonomy-label">${escapeHtml(label)}</span>
          <div class="listing-ssr-chips">${items
            .map((item) => `<span>${escapeHtml(item)}</span>`)
            .join("")}</div>
        </div>`
      : "";

  const expectationsHtml = expectationItems.length
    ? `<ul class="listing-ssr-expectations">${expectationItems
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>`
    : `<p class="listing-ssr-muted">Автор пока не заполнил отдельные ожидания. Ориентируйтесь на описание заявки.</p>`;

  const authorHref = authorUsername ? `/profile/${encodeURIComponent(authorUsername)}` : "";
  const authorNameHtml = authorHref
    ? `<a href="${escapeHtml(authorHref)}">${escapeHtml(authorName)}</a>`
    : escapeHtml(authorName);

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: listing.title,
    description: clip(plainBody, 500),
    url: canonical,
    author: {
      "@type": "Person",
      name: authorName,
      ...(authorUsername ? { url: `${base}/profile/${encodeURIComponent(authorUsername)}` } : {})
    },
    genre: [...new Set([...genres, ...fandoms])],
    keywords: [...new Set([...tags, ...characters])].join(", "),
    datePublished: listing.publishedAt || listing.createdAt,
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/LikeAction",
        userInteractionCount: likes
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/ReplyAction",
        userInteractionCount: responses
      }
    ]
  };

  const respondHref = `/listing/${encodeURIComponent(listing.id)}`;
  const reportHref = `/reports/new?entityType=LISTING&entityId=${encodeURIComponent(listing.id)}`;

  const body = `
      <article class="listing-ssr-card">
        <p class="listing-ssr-kicker">${isOpen ? "Открытая заявка Cofind 2" : "Закрытая заявка Cofind 2"}</p>
        <h1 class="listing-ssr-title">${escapeHtml(listing.title)}</h1>
        <div class="listing-ssr-meta">
          <span class="pill">${escapeHtml(typeLabel(listing.type))}</span>
          <span class="pill soft">${escapeHtml(ratingLabel(listing.ageRating))}</span>
          <span>Автор: ${authorNameHtml}</span>
          <span>${escapeHtml(responses)} ${escapeHtml(pluralize(responses, ["отклик", "отклика", "откликов"]))}</span>
          <span>${escapeHtml(likes)} ${escapeHtml(pluralize(likes, ["лайк", "лайка", "лайков"]))}</span>
        </div>
        <div class="listing-ssr-body rich-content">${bodyHtml || "<p>Описание появится позже.</p>"}</div>
        ${taxonomyBlock("Теги", tags)}
        ${taxonomyBlock("Жанры", genres)}
        ${taxonomyBlock("Фандомы", fandoms)}
        ${taxonomyBlock("Персонажи", characters)}
        <section class="listing-ssr-section">
          <h2>Ожидания автора</h2>
          ${expectationsHtml}
        </section>
        <section class="listing-ssr-author">
          <h2>Автор заявки</h2>
          <p class="listing-ssr-author-name">${authorNameHtml}</p>
          ${profile.activityLevel ? `<p class="listing-ssr-muted">Темп: ${escapeHtml(profile.activityLevel)}</p>` : ""}
          ${profile.writingStyle ? `<p class="listing-ssr-muted">Стиль: ${escapeHtml(profile.writingStyle)}</p>` : ""}
        </section>
        <div class="listing-ssr-actions">
          <a class="primary-button" href="${escapeHtml(respondHref)}">Откликнуться</a>
          <a class="ghost-button" href="${escapeHtml(reportHref)}">Пожаловаться</a>
        </div>
      </article>`;

  return documentShell({
    title: `${listing.title} — заявка Cofind 2`,
    description,
    canonical,
    robots: "index,follow",
    ogImage,
    ogImageWidth: 1200,
    ogImageHeight: 630,
    jsonLd,
    body
  });
}

export function renderListingNotFound(webUrl: string, slug: string) {
  const base = (webUrl || "").replace(/\/+$/, "");
  const body = `
      <article class="listing-ssr-card listing-ssr-notfound">
        <p class="listing-ssr-kicker">Cofind 2</p>
        <h1 class="listing-ssr-title">Заявка не найдена</h1>
        <p>Заявка <code>${escapeHtml(slug)}</code> не существует, снята с публикации или ещё не прошла модерацию.</p>
        <div class="listing-ssr-actions">
          <a class="primary-button" href="/feed">Открыть ленту заявок</a>
          <a class="ghost-button" href="/">На главную</a>
        </div>
      </article>`;
  return documentShell({
    title: "Заявка не найдена — Cofind 2",
    description: "Запрошенная заявка не найдена на Cofind 2.",
    canonical: `${base}/feed`,
    robots: "noindex,nofollow",
    body
  });
}

// --- Feed first-page server render (SSI fragment for /feed) ---

function statusLabel(listing: any) {
  return listing?.status === "CLOSED" ? "Закрыта" : "Открыта";
}

function updatedAgo(listing: any) {
  const value = listing?.publishedAt || listing?.updatedAt || listing?.createdAt;
  if (!value) return "недавно";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} ${pluralize(mins, ["минуту", "минуты", "минут"])} назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${pluralize(hours, ["час", "часа", "часов"])} назад`;
  const days = Math.floor(hours / 24);
  return `${days} ${pluralize(days, ["день", "дня", "дней"])} назад`;
}

function feedTaxonomy(label: string, items: string[]) {
  const list = [...new Set(items)].slice(0, 4);
  if (!list.length) return "";
  return `<div class="listing-card-taxonomy"><span>${escapeHtml(label)}</span><div class="tags">${list
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("")}</div></div>`;
}

export function renderFeedCard(listing: any) {
  const profile = listing.author?.profile || {};
  const authorName = profile.displayName || profile.username || "Автор";
  const username = profile.username || "";
  const slug = listing.slug || listing.id;
  const href = `/listings/${encodeURIComponent(slug)}`;
  const isOpen = listing.status !== "CLOSED";
  const responses = Number(listing.responses ?? listing._count?.responses ?? 0);
  const likes = Number(listing.likes ?? 0);
  const summary = clip(stripRichText(listing.body), 260);
  const genres = relationNames(listing.genres, "genre");
  const fandoms = relationNames(listing.fandoms, "fandom");
  const characters = relationNames(listing.characters, "character");
  const authorHtml = username
    ? `<a href="/profile/${encodeURIComponent(username)}" data-open-profile="${escapeHtml(username)}">${escapeHtml(authorName)}</a>`
    : escapeHtml(authorName);
  return `<article class="listing-card feed-listing-card" data-listing-id="${escapeHtml(listing.id)}">
      <div class="card-topline">
        <div>
          <span class="pill ${listing.ageRating === "ADULT" ? "warm" : "soft"}">${escapeHtml(typeLabel(listing.type))}</span>
          <span class="pill">${escapeHtml(ratingLabel(listing.ageRating))}</span>
          <span class="pill ${isOpen ? "soft" : "warm"}">${escapeHtml(statusLabel(listing))}</span>
        </div>
        <span>Обновлено ${escapeHtml(updatedAgo(listing))}</span>
      </div>
      <h2><a href="${escapeHtml(href)}" data-open-listing="${escapeHtml(listing.id)}">${escapeHtml(listing.title)}</a></h2>
      <p>${escapeHtml(summary)}</p>
      <div class="listing-card-meta">
        <span>Автор: ${authorHtml}</span>
        <span>${escapeHtml(responses)} ${escapeHtml(pluralize(responses, ["отклик", "отклика", "откликов"]))}</span>
      </div>
      ${feedTaxonomy("Жанры", genres)}
      ${feedTaxonomy("Фандомы", fandoms)}
      ${feedTaxonomy("Персонажи", characters)}
      <footer>
        <span>${escapeHtml(likes)} ${escapeHtml(pluralize(likes, ["лайк", "лайка", "лайков"]))}</span>
        <div class="button-row listing-card-actions">
          <a class="secondary-button" href="${escapeHtml(href)}" data-open-listing="${escapeHtml(listing.id)}">${isOpen ? "Откликнуться" : "Подробнее"}</a>
        </div>
      </footer>
    </article>`;
}

export function renderFeedCards(listings: any[]) {
  if (!Array.isArray(listings) || !listings.length) {
    return `<article class="listing-card feed-empty-state"><h2>Заявок пока нет.</h2><p>Создайте первую заявку и помогите запустить сообщество.</p><div class="button-row"><a class="secondary-button" href="/me/listings/new" data-view-link="new-listing">Создать заявку</a></div></article>`;
  }
  return listings.map((listing) => renderFeedCard(listing)).join("\n");
}
