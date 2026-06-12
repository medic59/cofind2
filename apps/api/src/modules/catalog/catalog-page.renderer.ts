import { plural, type PluralForms } from "../../common/pluralize";
import { documentShell, renderFeedCards } from "../listings/listing-page.renderer";

export type CatalogKind = "fandoms" | "genres" | "tags" | "characters";

const LISTING_FORMS: PluralForms = ["заявка", "заявки", "заявок"];

type KindMeta = {
  path: string;
  indexLabel: string;
  filterKey: "fandom" | "genre" | "tag" | "character";
  // Plural forms for the entity noun itself ("5 фандомов в каталоге").
  entityForms: PluralForms;
  titleTpl: (name: string) => string;
  descTpl: (name: string, count: number) => string;
  indexTitle: string;
  indexDesc: string;
};

const KIND_META: Record<CatalogKind, KindMeta> = {
  fandoms: {
    path: "/fandoms",
    indexLabel: "Фандомы",
    filterKey: "fandom",
    entityForms: ["фандом", "фандома", "фандомов"],
    titleTpl: (name) => `Поиск соавтора и партнёра по фандому ${name} — Cofind 2`,
    descTpl: (name, count) => `${plural(count, LISTING_FORMS)} по фандому ${name} на Cofind 2: соавторы, соигроки, бета-ридеры и команды. Найдите партнёра для фанфика или ролевой по ${name}.`,
    indexTitle: "Фандомы — Cofind 2",
    indexDesc: "Каталог фандомов Cofind 2: найдите соавтора, соигрока и команду по любимому фандому."
  },
  genres: {
    path: "/genres",
    indexLabel: "Жанры",
    filterKey: "genre",
    entityForms: ["жанр", "жанра", "жанров"],
    titleTpl: (name) => `Заявки и партнёры в жанре ${name} — Cofind 2`,
    descTpl: (name, count) => `${plural(count, LISTING_FORMS)} в жанре ${name} на Cofind 2: соавторство, ролевые, бета-ридинг и команды.`,
    indexTitle: "Жанры — Cofind 2",
    indexDesc: "Каталог жанров Cofind 2: найдите партнёров и заявки в нужном жанре."
  },
  tags: {
    path: "/tags",
    indexLabel: "Теги",
    filterKey: "tag",
    entityForms: ["тег", "тега", "тегов"],
    titleTpl: (name) => `Заявки по тегу ${name} — Cofind 2`,
    descTpl: (name, count) => `${plural(count, LISTING_FORMS)} по тегу ${name} на Cofind 2: соавторы, соигроки и команды.`,
    indexTitle: "Теги — Cofind 2",
    indexDesc: "Каталог тегов Cofind 2: заявки и творческие партнёры по темам."
  },
  characters: {
    path: "/characters",
    indexLabel: "Персонажи",
    filterKey: "character",
    entityForms: ["персонаж", "персонажа", "персонажей"],
    titleTpl: (name) => `Ролевые и фанфики по персонажу ${name} — Cofind 2`,
    descTpl: (name, count) => `${plural(count, LISTING_FORMS)} по персонажу ${name} на Cofind 2: соигроки, соавторы и команды.`,
    indexTitle: "Персонажи — Cofind 2",
    indexDesc: "Каталог персонажей Cofind 2: найдите партнёров по любимым персонажам."
  }
};

export function isCatalogKind(value: string): value is CatalogKind {
  return value === "fandoms" || value === "genres" || value === "tags" || value === "characters";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function clip(value: string, limit = 200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function feedFilterUrl(kind: CatalogKind, entity: any) {
  const meta = KIND_META[kind];
  // The SPA feed reads genre/fandom/character from the URL but not tag, so tag
  // CTAs fall back to a name search.
  if (kind === "tags") return `/feed?q=${encodeURIComponent(entity.name)}`;
  return `/feed?${meta.filterKey}=${encodeURIComponent(entity.slug)}`;
}

function chips(kind: CatalogKind, items: Array<{ slug: string; name: string }>) {
  const meta = KIND_META[kind];
  if (!items.length) return "";
  return `<div class="catalog-chips">${items
    .map((item) => `<a href="${escapeHtml(`${meta.path}/${encodeURIComponent(item.slug)}`)}">${escapeHtml(item.name)}</a>`)
    .join("")}</div>`;
}

function breadcrumbJsonLd(webUrl: string, trail: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${webUrl}${item.url}`
    }))
  };
}

export function renderCatalogIndex(kind: CatalogKind, entities: Array<{ slug: string; name: string }>, webUrl: string) {
  const meta = KIND_META[kind];
  const base = (webUrl || "").replace(/\/+$/, "");
  const canonical = `${base}${meta.path}`;
  const body = `
      <nav class="catalog-breadcrumb"><a href="/">Главная</a> / <span>${escapeHtml(meta.indexLabel)}</span></nav>
      <article class="listing-ssr-card">
        <h1 class="listing-ssr-title">${escapeHtml(meta.indexLabel)}</h1>
        <p>${escapeHtml(meta.indexDesc)}</p>
        <p class="listing-ssr-muted">${plural(entities.length, meta.entityForms)} в каталоге</p>
        ${chips(kind, entities)}
        <div class="listing-ssr-actions">
          <a class="ghost-button" href="/feed">Открыть ленту заявок</a>
        </div>
      </article>`;
  return documentShell({
    title: meta.indexTitle,
    description: meta.indexDesc,
    canonical,
    robots: "index,follow",
    ogImage: `${base}/og-image.png`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: meta.indexLabel,
      url: canonical,
      mainEntity: {
        "@type": "ItemList",
        itemListElement: entities.slice(0, 200).map((entity, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: entity.name,
          url: `${base}${meta.path}/${encodeURIComponent(entity.slug)}`
        }))
      }
    },
    body
  });
}

export function renderCatalogDetail(options: {
  kind: CatalogKind;
  entity: any;
  listings: any[];
  total: number;
  siblings: Array<{ slug: string; name: string }>;
  webUrl: string;
}) {
  const { kind, entity, listings, total, siblings, webUrl } = options;
  const meta = KIND_META[kind];
  const base = (webUrl || "").replace(/\/+$/, "");
  const canonical = `${base}${meta.path}/${encodeURIComponent(entity.slug)}`;
  const name = entity.name;
  const title = entity.seoTitle || meta.titleTpl(name);
  const description = clip(entity.seoDescription || meta.descTpl(name, total), 200);
  const aliases = Array.isArray(entity.aliases) ? entity.aliases.filter(Boolean) : [];
  const feedUrl = feedFilterUrl(kind, entity);
  const fandomLink = kind === "characters" && entity.fandom
    ? `<p class="listing-ssr-muted">Фандом: <a href="/fandoms/${encodeURIComponent(entity.fandom.slug)}">${escapeHtml(entity.fandom.name)}</a></p>`
    : "";

  const listingsBlock = listings.length
    ? `<div class="listing-list">${renderFeedCards(listings)}</div>
       <div class="listing-ssr-actions"><a class="primary-button" href="${escapeHtml(feedUrl)}">Открыть все ${plural(total, LISTING_FORMS)} в ленте с фильтрами</a></div>`
    : `<p class="listing-ssr-muted">Пока нет опубликованных заявок. Создайте первую — по ${escapeHtml(name)} быстро находят партнёров.</p>
       <div class="listing-ssr-actions"><a class="primary-button" href="/me/listings/new">Создать заявку</a></div>`;

  const body = `
      <nav class="catalog-breadcrumb"><a href="/">Главная</a> / <a href="${escapeHtml(meta.path)}">${escapeHtml(meta.indexLabel)}</a> / <span>${escapeHtml(name)}</span></nav>
      <article class="listing-ssr-card">
        <p class="listing-ssr-kicker">${escapeHtml(meta.indexLabel)}</p>
        <h1 class="listing-ssr-title">${escapeHtml(name)}</h1>
        <p>${escapeHtml(entity.description || meta.descTpl(name, total))}</p>
        ${aliases.length ? `<p class="listing-ssr-muted">Также известно как: ${escapeHtml(aliases.join(", "))}</p>` : ""}
        ${fandomLink}
        <section class="listing-ssr-section">
          <h2>Заявки по «${escapeHtml(name)}»</h2>
          ${listingsBlock}
        </section>
        ${siblings.length ? `<section class="listing-ssr-section"><h2>Смотрите также</h2>${chips(kind, siblings)}<p class="listing-ssr-muted"><a href="${escapeHtml(meta.path)}">Все ${escapeHtml(meta.indexLabel.toLowerCase())}</a></p></section>` : ""}
      </article>`;

  return documentShell({
    title,
    description,
    canonical,
    robots: "index,follow",
    ogImage: `${base}/og-image.png`,
    jsonLd: breadcrumbJsonLd(base, [
      { name: "Главная", url: "/" },
      { name: meta.indexLabel, url: meta.path },
      { name, url: `${meta.path}/${encodeURIComponent(entity.slug)}` }
    ]),
    body
  });
}

export function renderCatalogNotFound(kind: CatalogKind, webUrl: string) {
  const meta = KIND_META[kind];
  const base = (webUrl || "").replace(/\/+$/, "");
  const body = `
      <article class="listing-ssr-card listing-ssr-notfound">
        <p class="listing-ssr-kicker">${escapeHtml(meta.indexLabel)}</p>
        <h1 class="listing-ssr-title">Не найдено</h1>
        <p>Такой элемент каталога не существует или скрыт.</p>
        <div class="listing-ssr-actions">
          <a class="primary-button" href="${escapeHtml(meta.path)}">Все ${escapeHtml(meta.indexLabel.toLowerCase())}</a>
          <a class="ghost-button" href="/feed">Лента заявок</a>
        </div>
      </article>`;
  return documentShell({
    title: `Не найдено — ${meta.indexLabel} — Cofind 2`,
    description: "Элемент каталога не найден на Cofind 2.",
    canonical: `${base}${meta.path}`,
    robots: "noindex,nofollow",
    body
  });
}
