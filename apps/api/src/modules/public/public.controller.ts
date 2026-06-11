import { Controller, Get, Query, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { toPublicAd, toPublicPlan, toPublicSeoPage } from "../../common/public-view";
import { Public } from "../auth/public.decorator";
import { PublicAdsQueryDto, SeoPageQueryDto } from "./dto";
import { PublicService } from "./public.service";

const SITEMAP_ROUTES = ["/", "/feed", "/chat", "/suggestions", "/help", "/rules", "/privacy", "/contacts"];

function publicWebUrl() {
  return String(process.env.PUBLIC_WEB_URL || "").split(",")[0].trim().replace(/\/+$/, "");
}

function escapeXml(value: string) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderSitemap(webUrl: string, listings: Array<{ slug: string; updatedAt: Date }>) {
  const urls: string[] = [];
  for (const path of SITEMAP_ROUTES) {
    urls.push(`  <url><loc>${escapeXml(`${webUrl}${path}`)}</loc></url>`);
  }
  for (const listing of listings) {
    if (!listing.slug) continue;
    urls.push(
      `  <url><loc>${escapeXml(`${webUrl}/listings/${encodeURIComponent(listing.slug)}`)}</loc>` +
      `<lastmod>${new Date(listing.updatedAt).toISOString()}</lastmod></url>`
    );
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
    const listings = await this.publicService.sitemapListings();
    res.status(200).type("application/xml").send(renderSitemap(publicWebUrl(), listings));
  }
}
