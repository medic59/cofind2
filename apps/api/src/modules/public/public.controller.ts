import { Controller, Get, Query, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { toPublicAd, toPublicPlan, toPublicSeoPage } from "../../common/public-view";
import { Public } from "../auth/public.decorator";
import { PublicAdsQueryDto, SeoPageQueryDto } from "./dto";
import { PublicService } from "./public.service";

const SITEMAP_ROUTES = ["/", "/feed", "/chat", "/suggestions", "/help", "/rules", "/privacy", "/contacts", "/fandoms", "/genres", "/tags"];

type SlugDated = { slug: string; updatedAt: Date };

function publicWebUrl() {
  return String(process.env.PUBLIC_WEB_URL || "").split(",")[0].trim().replace(/\/+$/, "");
}

function escapeXml(value: string) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function entryWithLastmod(loc: string, updatedAt: Date) {
  return `  <url><loc>${escapeXml(loc)}</loc><lastmod>${new Date(updatedAt).toISOString()}</lastmod></url>`;
}

function renderSitemap(
  webUrl: string,
  listings: SlugDated[],
  catalog: { fandoms: SlugDated[]; genres: SlugDated[]; tags: SlugDated[] }
) {
  const urls: string[] = [];
  for (const path of SITEMAP_ROUTES) {
    urls.push(`  <url><loc>${escapeXml(`${webUrl}${path}`)}</loc></url>`);
  }
  const catalogGroups: Array<[string, SlugDated[]]> = [
    ["fandoms", catalog.fandoms],
    ["genres", catalog.genres],
    ["tags", catalog.tags]
  ];
  for (const [kind, entities] of catalogGroups) {
    for (const entity of entities) {
      if (!entity.slug) continue;
      urls.push(entryWithLastmod(`${webUrl}/${kind}/${encodeURIComponent(entity.slug)}`, entity.updatedAt));
    }
  }
  for (const listing of listings) {
    if (!listing.slug) continue;
    urls.push(entryWithLastmod(`${webUrl}/listings/${encodeURIComponent(listing.slug)}`, listing.updatedAt));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
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

  // Dynamic sitemap (served at /sitemap.xml via nginx): static routes (no query
  // params) plus every published listing with lastmod from updatedAt.
  @Get("sitemap.xml")
  @ApiExcludeEndpoint()
  async sitemap(@Res() res: any) {
    const [listings, catalog] = await Promise.all([
      this.publicService.sitemapListings(),
      this.publicService.sitemapCatalog()
    ]);
    res.status(200).type("application/xml").send(renderSitemap(publicWebUrl(), listings, catalog));
  }
}
