import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { plural, type PluralForms } from "../../common/pluralize";

// Dynamic 1200x630 Open Graph card for a listing, rendered with satori (HTML/CSS
// -> SVG) + @resvg/resvg-js (SVG -> PNG) and cached on disk by slug + updatedAt.

const BRAND = "#2fbf9f";
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

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

// satori is ESM-only; under module:CommonJS, `import()` would be downleveled to
// require() (which throws on an ESM package), so reach for a real dynamic import.
const dynamicImport = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;

type FontSpec = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };
let fontsCache: FontSpec[] | null = null;
function loadFonts(): FontSpec[] {
  if (fontsCache) return fontsCache;
  // pnpm start runs with cwd = apps/api, where assets/fonts is copied by the image.
  const dir = resolve(process.cwd(), "assets/fonts");
  fontsCache = [
    { name: "Roboto", data: readFileSync(join(dir, "Roboto-Regular.ttf")), weight: 400, style: "normal" },
    { name: "Roboto", data: readFileSync(join(dir, "Roboto-Bold.ttf")), weight: 700, style: "normal" }
  ];
  return fontsCache;
}

function clip(value: string, limit: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function names(items: any[] | undefined, key: string): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((e) => e?.[key]?.name || e?.name).filter((n): n is string => Boolean(n));
}

// Minimal hyperscript for satori's React-element-like nodes.
function h(type: string, style: Record<string, any>, children?: any): any {
  return { type, props: { style, ...(children !== undefined ? { children } : {}) } };
}

function pill(text: string, primary: boolean) {
  return h(
    "div",
    {
      display: "flex",
      alignItems: "center",
      padding: "10px 24px",
      marginRight: "16px",
      borderRadius: "999px",
      backgroundColor: primary ? BRAND : "rgba(255,255,255,0.10)",
      color: primary ? "#05221d" : "#e6fbf4",
      fontSize: 28,
      fontWeight: 700
    },
    text
  );
}

function buildCard(listing: any) {
  const title = clip(String(listing.title || "Творческая заявка"), 110);
  const type = TYPE_LABELS[listing.type] || "Заявка";
  const rating = RATING_LABELS[listing.ageRating] || "";
  const tags = [...new Set([...names(listing.fandoms, "fandom"), ...names(listing.genres, "genre"), ...names(listing.tags, "tag")])].slice(0, 3);

  const tagRow = tags.length
    ? h(
        "div",
        { display: "flex" },
        tags.map((t) =>
          h(
            "div",
            { display: "flex", alignItems: "center", padding: "8px 18px", marginRight: "12px", borderRadius: "12px", backgroundColor: "rgba(255,255,255,0.08)", color: "#bfeede", fontSize: 24 },
            `#${t}`
          )
        )
      )
    : h("div", { display: "flex" }, "");

  return h(
    "div",
    {
      width: `${OG_WIDTH}px`,
      height: `${OG_HEIGHT}px`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "72px",
      backgroundColor: "#0c1a17",
      backgroundImage: "linear-gradient(135deg, #0b1916 0%, #10312a 100%)",
      color: "#ffffff",
      fontFamily: "Roboto"
    },
    [
      h("div", { display: "flex", alignItems: "center" }, [
        h(
          "div",
          { display: "flex", alignItems: "center", justifyContent: "center", width: "60px", height: "60px", marginRight: "20px", borderRadius: "16px", backgroundColor: BRAND, color: "#05221d", fontSize: 32, fontWeight: 700 },
          "C2"
        ),
        h("div", { display: "flex", fontSize: 36, fontWeight: 700 }, "Cofind 2")
      ]),
      h("div", { display: "flex", flexDirection: "column" }, [
        h("div", { display: "flex", marginBottom: "30px" }, [pill(type, true), ...(rating ? [pill(rating, false)] : [])]),
        h("div", { display: "flex", fontSize: 66, fontWeight: 700, lineHeight: 1.08, color: "#ffffff" }, title)
      ]),
      h("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
        tagRow,
        h("div", { display: "flex", fontSize: 30, fontWeight: 700, color: BRAND }, "cofind2.com")
      ])
    ]
  );
}

async function renderPng(element: any): Promise<Buffer> {
  const satori = (await dynamicImport("satori")).default;
  const { Resvg } = await dynamicImport("@resvg/resvg-js");
  const svg: string = await satori(element, { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
  return Buffer.from(png);
}

const CACHE_ROOT = resolve(process.cwd(), "uploads/og");

// Disk-cached PNG. The cacheKey is a content signature, so any change to the
// rendered content yields a new file (auto-invalidation). Best-effort cache.
async function cachedPng(subdir: string, cacheKey: string, render: () => Promise<Buffer>): Promise<Buffer> {
  const dir = join(CACHE_ROOT, subdir);
  const file = join(dir, `${createHash("sha1").update(cacheKey).digest("hex").slice(0, 24)}.png`);
  try {
    return await readFile(file);
  } catch {
    // not cached yet
  }
  const png = await render();
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, png);
  } catch {
    // best-effort cache; still return the freshly rendered bytes
  }
  return png;
}

export function renderListingOgPng(listing: any): Promise<Buffer> {
  return renderPng(buildCard(listing));
}

export function getListingOgPng(listing: any): Promise<Buffer> {
  const slug = String(listing.slug || listing.id || "listing");
  const stamp = new Date(listing.updatedAt || listing.createdAt || 0).getTime() || 0;
  return cachedPng("listings", `${slug}|${stamp}`, () => renderListingOgPng(listing));
}

// ---- Shared card chrome (brand header/footer, 1200x630 shell) ----

function shell(children: any) {
  return h(
    "div",
    {
      width: `${OG_WIDTH}px`,
      height: `${OG_HEIGHT}px`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "72px",
      backgroundColor: "#0c1a17",
      backgroundImage: "linear-gradient(135deg, #0b1916 0%, #10312a 100%)",
      color: "#ffffff",
      fontFamily: "Roboto"
    },
    children
  );
}

function brandHeader() {
  return h("div", { display: "flex", alignItems: "center" }, [
    h("div", { display: "flex", alignItems: "center", justifyContent: "center", width: "60px", height: "60px", marginRight: "20px", borderRadius: "16px", backgroundColor: BRAND, color: "#05221d", fontSize: 32, fontWeight: 700 }, "C2"),
    h("div", { display: "flex", fontSize: 36, fontWeight: 700 }, "Cofind 2")
  ]);
}

function brandFooter(leftText: string) {
  return h("div", { display: "flex", alignItems: "center", justifyContent: "space-between" }, [
    h("div", { display: "flex", fontSize: 28, color: "#9fc7bb" }, leftText || ""),
    h("div", { display: "flex", fontSize: 30, fontWeight: 700, color: BRAND }, "cofind2.com")
  ]);
}

function initials(name: string) {
  const parts = String(name || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || "").join("").toUpperCase() || "?";
}

const LISTING_FORMS: PluralForms = ["заявка", "заявки", "заявок"];
const RESPONSE_FORMS: PluralForms = ["отклик", "отклика", "откликов"];
const LIKE_FORMS: PluralForms = ["лайк", "лайка", "лайков"];

// ---- Profile card ----

function buildProfileCard(profile: any) {
  const displayName = clip(String(profile.displayName || profile.username || "Автор"), 48);
  const handle = profile.username ? `@${profile.username}` : "";
  const stats = profile.stats || {};
  const statline = [
    plural(Number(stats.listings ?? 0), LISTING_FORMS),
    plural(Number(stats.responses ?? 0), RESPONSE_FORMS),
    plural(Number(stats.likes ?? 0), LIKE_FORMS)
  ].join("   ·   ");
  return shell([
    brandHeader(),
    h("div", { display: "flex", alignItems: "center" }, [
      h("div", { display: "flex", alignItems: "center", justifyContent: "center", width: "150px", height: "150px", marginRight: "40px", borderRadius: "75px", backgroundColor: "rgba(47,191,159,0.18)", color: BRAND, fontSize: 66, fontWeight: 700 }, initials(displayName)),
      h("div", { display: "flex", flexDirection: "column" }, [
        h("div", { display: "flex", fontSize: 60, fontWeight: 700 }, displayName),
        ...(handle ? [h("div", { display: "flex", fontSize: 34, color: "#9fc7bb", marginTop: "10px" }, handle)] : [])
      ])
    ]),
    brandFooter(statline)
  ]);
}

export function renderProfileOgPng(profile: any): Promise<Buffer> {
  return renderPng(buildProfileCard(profile));
}

export function getProfileOgPng(profile: any): Promise<Buffer> {
  const s = profile.stats || {};
  const key = `${profile.username || ""}|${profile.displayName || ""}|${s.listings ?? 0}|${s.responses ?? 0}|${s.likes ?? 0}`;
  return cachedPng("profiles", key, () => renderProfileOgPng(profile));
}

// ---- Catalog card (fandom / genre / tag) ----

const CATALOG_KICKER: Record<string, string> = { fandoms: "Фандом", genres: "Жанр", tags: "Тег", characters: "Персонаж" };

function buildCatalogCard(kind: string, name: string, total: number) {
  return shell([
    brandHeader(),
    h("div", { display: "flex", flexDirection: "column" }, [
      h("div", { display: "flex", fontSize: 30, color: BRAND, fontWeight: 700, marginBottom: "18px" }, CATALOG_KICKER[kind] || "Каталог"),
      h("div", { display: "flex", fontSize: 70, fontWeight: 700, lineHeight: 1.05 }, clip(String(name || ""), 60))
    ]),
    brandFooter(plural(Number(total || 0), LISTING_FORMS))
  ]);
}

export function renderCatalogOgPng(kind: string, name: string, total: number): Promise<Buffer> {
  return renderPng(buildCatalogCard(kind, name, total));
}

export function getCatalogOgPng(kind: string, slug: string, name: string, total: number): Promise<Buffer> {
  return cachedPng(`catalog-${kind}`, `${slug}|${name}|${total}`, () => renderCatalogOgPng(kind, name, total));
}

export const OG_IMAGE_SIZE = { width: OG_WIDTH, height: OG_HEIGHT };
