import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PageQueryDto } from "../../common/page-query.dto";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { toPublicCatalogItem } from "../../common/public-view";
import { CatalogService } from "./catalog.service";
import { CreateSuggestionDto } from "./dto";

@ApiTags("Catalog")
@Controller()
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

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
