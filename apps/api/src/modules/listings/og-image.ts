import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

export async function renderListingOgPng(listing: any): Promise<Buffer> {
  const satori = (await dynamicImport("satori")).default;
  const { Resvg } = await dynamicImport("@resvg/resvg-js");
  const svg: string = await satori(buildCard(listing), { width: OG_WIDTH, height: OG_HEIGHT, fonts: loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH } }).render().asPng();
  return Buffer.from(png);
}

const CACHE_DIR = resolve(process.cwd(), "uploads/og/listings");

// Disk-cached PNG keyed by slug + updatedAt: editing the listing changes
// updatedAt and invalidates the cache (a new file is generated).
export async function getListingOgPng(listing: any): Promise<Buffer> {
  const slug = String(listing.slug || listing.id || "listing");
  const stamp = new Date(listing.updatedAt || listing.createdAt || 0).getTime() || 0;
  const key = createHash("sha1").update(`${slug}`).digest("hex").slice(0, 16);
  const file = join(CACHE_DIR, `${key}__${stamp}.png`);
  try {
    return await readFile(file);
  } catch {
    // not cached yet
  }
  const png = await renderListingOgPng(listing);
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, png);
  } catch {
    // best-effort cache; still return the freshly rendered bytes
  }
  return png;
}

export const OG_IMAGE_SIZE = { width: OG_WIDTH, height: OG_HEIGHT };
