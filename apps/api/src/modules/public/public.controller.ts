import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { toPublicAd, toPublicPlan, toPublicSeoPage } from "../../common/public-view";
import { Public } from "../auth/public.decorator";
import { PublicAdsQueryDto, SeoPageQueryDto } from "./dto";
import { PublicService, type SitemapData } from "./public.service";

// Static, indexable SPA/SSR routes (no query parameters — those never belong in
// a sitemap). The /feed?page=N variants are intentionally excluded.
const SITEMAP_ROUTES = ["/", "/feed", "/chat", "/suggestions", "/help", "/rules", "/privacy", "/contacts", "/fandoms", "/genres", "/tags"];

// Above this many total URLs, split into a sitemap index with one file per type.
const SITEMAP_INDEX_THRESHOLD = 5000;

type SitemapKind = "pages" | "listings" | "fandoms" | "genres" | "tags" | "profiles";

function publicWebUrl() {
  return String(process.env.PUBLIC_WEB_URL || "").split(",")[0].trim().replace(/\/+$/, "");
}

function escapeXml(value: string) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function urlEntry(loc: string, lastmod?: Date) {
  const mod = lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : "";
  return `  <url><loc>${escapeXml(loc)}</loc>${mod}</url>`;
}

function urlset(entries: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}

// Entries for one sitemap section, in canonical absolute-URL form.
function kindEntries(kind: SitemapKind, webUrl: string, data: SitemapData): string[] {
  if (kind === "pages") return SITEMAP_ROUTES.map((path) => urlEntry(`${webUrl}${path}`));
  if (kind === "listings") return data.listings.filter((l) => l.slug).map((l) => urlEntry(`${webUrl}/listings/${encodeURIComponent(l.slug)}`, l.updatedAt));
  if (kind === "profiles") return data.profiles.filter((p) => p.username).map((p) => urlEntry(`${webUrl}/profile/${encodeURIComponent(p.username)}`, p.updatedAt));
  const entities = kind === "fandoms" ? data.fandoms : kind === "genres" ? data.genres : data.tags;
  return entities.filter((e) => e.slug).map((e) => urlEntry(`${webUrl}/${kind}/${encodeURIComponent(e.slug)}`, e.updatedAt));
}

function latestLastmod(kind: SitemapKind, data: SitemapData): Date | undefined {
  const dates =
    kind === "listings" ? data.listings.map((l) => l.updatedAt)
    : kind === "profiles" ? data.profiles.map((p) => p.updatedAt)
    : kind === "fandoms" ? data.fandoms.map((e) => e.updatedAt)
    : kind === "genres" ? data.genres.map((e) => e.updatedAt)
    : kind === "tags" ? data.tags.map((e) => e.updatedAt)
    : [];
  if (!dates.length) return undefined;
  return dates.reduce((a, b) => (new Date(b) > new Date(a) ? b : a));
}

function totalUrlCount(data: SitemapData) {
  return SITEMAP_ROUTES.length + data.listings.length + data.fandoms.length + data.genres.length + data.tags.length + data.profiles.length;
}

const ALL_KINDS: SitemapKind[] = ["pages", "listings", "fandoms", "genres", "tags", "profiles"];

function renderSingleSitemap(webUrl: string, data: SitemapData) {
  return urlset(ALL_KINDS.flatMap((kind) => kindEntries(kind, webUrl, data)));
}

function renderSitemapIndex(webUrl: string, data: SitemapData) {
  const sitemaps = ALL_KINDS
    .filter((kind) => kindEntries(kind, webUrl, data).length > 0)
    .map((kind) => {
      const lastmod = kind === "pages" ? undefined : latestLastmod(kind, data);
      const mod = lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : "";
      return `  <sitemap><loc>${escapeXml(`${webUrl}/sitemap-${kind}.xml`)}</loc>${mod}</sitemap>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps.join("\n")}\n</sitemapindex>\n`;
}

function isSitemapKind(value: string): value is SitemapKind {
  return (ALL_KINDS as string[]).includes(value);
}

@ApiTags("Public")
@Public()
@Controller()
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get("subscription/plans")
  async plans() {
    return (await this.publicService.plans()).map(toPublicPlan);
  }

  @Get("settings")
  settings() {
    return this.publicService.settings();
  }

  @Get("ads/placements")
  async ads(@Query() query: PublicAdsQueryDto) {
    return (await this.publicService.ads(query.position)).map(toPublicAd);
  }

  @Get("seo/page")
  async seoPage(@Query() query: SeoPageQueryDto) {
    const page = await this.publicService.seoPage(query.path || "/");
    return page ? toPublicSeoPage(page) : null;
  }

  // Dynamic sitemap (served at /sitemap.xml via nginx): static routes plus every
  // published listing, catalog entity and public profile, with lastmod from
  // updatedAt. Cached 1h. Above 5000 URLs it returns a sitemap index that points
  // at one /sitemap-<kind>.xml per type.
  @Get("sitemap.xml")
  @ApiExcludeEndpoint()
  async sitemap(@Res() res: any) {
    const data = await this.publicService.sitemapData();
    const webUrl = publicWebUrl();
    const body = totalUrlCount(data) > SITEMAP_INDEX_THRESHOLD
      ? renderSitemapIndex(webUrl, data)
      : renderSingleSitemap(webUrl, data);
    res.status(200).type("application/xml").send(body);
  }

  // Per-type sub-sitemap (served at /sitemap-<kind>.xml via nginx) referenced by
  // the sitemap index when the total exceeds the per-file threshold.
  @Get("sitemap-:kind.xml")
  @ApiExcludeEndpoint()
  async sitemapKind(@Param("kind") kind: string, @Res() res: any) {
    if (!isSitemapKind(kind)) {
      res.status(404).type("application/xml").send(urlset([]));
      return;
    }
    const data = await this.publicService.sitemapData();
    res.status(200).type("application/xml").send(urlset(kindEntries(kind, publicWebUrl(), data)));
  }
}
