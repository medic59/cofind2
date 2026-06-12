import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import { PageQueryDto } from "../../common/page-query.dto";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { CreateListingDto, ListListingsQueryDto, RespondListingDto, UpdateListingDto, UpdateResponseStatusDto } from "./dto";
import { serializeListingResult, toPublicListing } from "../../common/public-view";
import { renderFeedCards, renderListingNotFound, renderListingPage } from "./listing-page.renderer";
import { getListingOgPng } from "./og-image";
import { ListingsService } from "./listings.service";

function publicWebUrl() {
  return String(process.env.PUBLIC_WEB_URL || "")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
}

@ApiTags("Listings")
@Controller("listings")
@UseGuards(AuthGuard)
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get()
  async list(@Query() query: ListListingsQueryDto, @CurrentUser() user?: RequestUser) {
    return serializeListingResult(await this.listings.list(query, user?.id));
  }

  // HTML fragment of the feed's first page, injected into /feed via nginx SSI so
  // the listing cards are server-rendered; the SPA hydrates filters/paging on top.
  @Public()
  @ApiExcludeEndpoint()
  @Get("feed-cards")
  async feedCards(@Res() res: any) {
    const result: any = await this.listings.list({});
    const items = Array.isArray(result) ? result : result.items || result.hits || [];
    res.status(200).type("html").send(renderFeedCards(items));
  }

  @ApiBearerAuth()
  @Get("mine")
  mine(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.listings.mine(user.id, query);
  }

  @ApiBearerAuth()
  @Get("mine/responses")
  myResponses(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.listings.myResponses(user.id, query);
  }

  @ApiBearerAuth()
  @Get("mine/incoming-responses")
  incomingResponses(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.listings.incomingResponses(user.id, query);
  }

  @ApiBearerAuth()
  @Get("mine/:id")
  getMine(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.listings.getMine(user.id, id);
  }

  @Public()
  @ApiExcludeEndpoint()
  @Get(":slug/page")
  async page(@Param("slug") slug: string, @Res() res: any) {
    const webUrl = publicWebUrl();
    try {
      const listing = await this.listings.get(slug);
      res.status(200).type("html").send(renderListingPage(listing, webUrl, slug));
    } catch (error) {
      if (error instanceof NotFoundException) {
        res.status(404).type("html").send(renderListingNotFound(webUrl, slug));
        return;
      }
      throw error;
    }
  }

  // Dynamic Open Graph card (1200x630 PNG) for /listings/<slug>, served via nginx
  // at /listings/<slug>/og.png. Falls back to the static brand image so a social
  // crawler never sees a broken og:image, whatever goes wrong.
  @Public()
  @ApiExcludeEndpoint()
  @Get(":slug/og.png")
  async ogImage(@Param("slug") slug: string, @Res() res: any) {
    try {
      const listing = await this.listings.get(slug);
      const png = await getListingOgPng(listing);
      res.status(200);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(png);
    } catch {
      res.redirect(302, `${publicWebUrl()}/og-image.png`);
    }
  }

  @Public()
  @Get(":slugOrId")
  async get(@Param("slugOrId") slugOrId: string, @CurrentUser() user?: RequestUser) {
    return toPublicListing(await this.listings.get(slugOrId, user?.id), { includeMeta: true });
  }

  @ApiBearerAuth()
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateListingDto) {
    return this.listings.create(user.id, dto);
  }

  @ApiBearerAuth()
  @Patch(":id")
  update(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: UpdateListingDto) {
    return this.listings.update(user.id, id, dto);
  }

  @ApiBearerAuth()
  @Post(":id/publish")
  publish(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.listings.publish(user.id, id);
  }

  @ApiBearerAuth()
  @Post(":id/close")
  close(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.listings.changeStatus(user.id, id, "CLOSED");
  }

  @ApiBearerAuth()
  @Post(":id/archive")
  archive(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.listings.changeStatus(user.id, id, "ARCHIVED");
  }

  @ApiBearerAuth()
  @Post(":id/delete")
  delete(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.listings.deleteOwn(user.id, id);
  }

  @ApiBearerAuth()
  @Post(":id/respond")
  respond(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: RespondListingDto) {
    return this.listings.respond(user.id, id, dto);
  }

  @ApiBearerAuth()
  @Get(":id/responses")
  responses(@CurrentUser() user: RequestUser, @Param("id") id: string, @Query() query: PageQueryDto) {
    return this.listings.listingResponses(user.id, id, query);
  }

  @ApiBearerAuth()
  @Post("/responses/:id/status")
  updateResponseStatus(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: UpdateResponseStatusDto) {
    return this.listings.updateResponseStatus(user.id, id, dto);
  }

  @ApiBearerAuth()
  @Post(":id/like")
  like(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.listings.toggleLike(user.id, id);
  }
}
