import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PageQueryDto } from "../../common/page-query.dto";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { CatalogService } from "./catalog.service";
import { CreateSuggestionDto } from "./dto";

@ApiTags("Catalog")
@Controller()
@UseGuards(AuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get("tags")
  tags() {
    return this.catalog.tags();
  }

  @Public()
  @Get("genres")
  genres() {
    return this.catalog.genres();
  }

  @Public()
  @Get("fandoms")
  fandoms() {
    return this.catalog.fandoms();
  }

  @Public()
  @Get("characters")
  characters(@Query("fandom") fandom?: string) {
    return this.catalog.characters(fandom);
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
