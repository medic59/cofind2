import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { PageQueryDto } from "../../common/page-query.dto";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { toPublicCatalogItem } from "../../common/public-view";
import { getCatalogOgPng } from "../listings/og-image";
import { ListingsService } from "../listings/listings.service";
import { CatalogService } from "./catalog.service";
import { CatalogKind, isCatalogKind, renderCatalogDetail, renderCatalogIndex, renderCatalogNotFound } from "./catalog-page.renderer";
import { CreateSuggestionDto } from "./dto";

function publicWebUrl() {
  return String(process.env.PUBLIC_WEB_URL || "").split(",")[0].trim().replace(/\/+$/, "");
}

const FILTER_KEY: Record<CatalogKind, "fandom" | "genre" | "tag" | "character"> = {
  fandoms: "fandom",
  genres: "genre",
  tags: "tag",
  characters: "character"
};

@ApiTags("Catalog")
@Controller()
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly listings: ListingsService
  ) {}

  @Public()
  @ApiExcludeEndpoint()
  @Get("catalog/:kind/page")
  async catalogIndex(@Param("kind") kind: string, @Res() res: any) {
    const webUrl = publicWebUrl();
    if (!isCatalogKind(kind)) {
      res.status(404).type("html").send(renderCatalogNotFound("fandoms", webUrl));
      return;
    }
    const entities = await this.catalog.listEntities(kind);
    res.status(200).type("html").send(renderCatalogIndex(kind, entities, webUrl));
  }

  @Public()
  @ApiExcludeEndpoint()
  @Get("catalog/:kind/:slug/page")
  async catalogDetail(@Param("kind") kind: string, @Param("slug") slug: string, @Res() res: any) {
    const webUrl = publicWebUrl();
    if (!isCatalogKind(kind)) {
      res.status(404).type("html").send(renderCatalogNotFound("fandoms", webUrl));
      return;
    }
    const entity = await this.catalog.entityBySlug(kind, slug);
    if (!entity) {
      res.status(404).type("html").send(renderCatalogNotFound(kind, webUrl));
      return;
    }
    const result: any = await this.listings.list({ [FILTER_KEY[kind]]: entity.slug, pageSize: 20 } as any);
    const items = Array.isArray(result) ? result : result.items || [];
    const total = Array.isArray(result) ? items.length : (result.total ?? items.length);
    const siblings = await this.catalog.siblings(kind, entity.slug);
    res.status(200).type("html").send(renderCatalogDetail({ kind, entity, listings: items, total, siblings, webUrl }));
  }

  // Dynamic 1200x630 OG card for a catalog entity (served at
  // /(fandoms|genres|tags)/<slug>/og.png via nginx). Brand-image fallback.
  @Public()
  @ApiExcludeEndpoint()
  @Get("catalog/:kind/:slug/og.png")
  async catalogOg(@Param("kind") kind: string, @Param("slug") slug: string, @Res() res: any) {
    try {
      if (!isCatalogKind(kind)) throw new Error("unknown kind");
      const entity = await this.catalog.entityBySlug(kind, slug);
      if (!entity) throw new Error("not found");
      const result: any = await this.listings.list({ [FILTER_KEY[kind]]: entity.slug, pageSize: 1 } as any);
      const total = Array.isArray(result) ? result.length : (result.total ?? 0);
      const png = await getCatalogOgPng(kind, entity.slug, entity.name, total);
      res.status(200);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(png);
    } catch {
      res.redirect(302, `${publicWebUrl()}/og-image.png`);
    }
  }

  @Public()
  @Get("tags")
  async tags() {
    return (await this.catalog.tags()).map(toPublicCatalogItem);
  }

  @Public()
  @Get("genres")
  async genres() {
    return (await this.catalog.genres()).map(toPublicCatalogItem);
  }

  @Public()
  @Get("fandoms")
  async fandoms() {
    return (await this.catalog.fandoms()).map(toPublicCatalogItem);
  }

  @Public()
  @Get("characters")
  async characters(@Query("fandom") fandom?: string) {
    return (await this.catalog.characters(fandom)).map(toPublicCatalogItem);
  }

  @ApiBearerAuth()
  @Post("suggestions")
  suggest(@CurrentUser() user: RequestUser, @Body() dto: CreateSuggestionDto) {
    return this.catalog.suggest(user.id, dto);
  }

  @ApiBearerAuth()
  @Get("suggestions/my")
  mySuggestions(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.catalog.mySuggestions(user.id, query);
  }
}
