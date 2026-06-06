import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PageQueryDto } from "../../common/page-query.dto";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { CreateListingDto, ListListingsQueryDto, RespondListingDto, UpdateListingDto, UpdateResponseStatusDto } from "./dto";
import { ListingsService } from "./listings.service";

@ApiTags("Listings")
@Controller("listings")
@UseGuards(AuthGuard)
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get()
  list(@Query() query: ListListingsQueryDto, @CurrentUser() user?: RequestUser) {
    return this.listings.list(query, user?.id);
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
  @Get(":slugOrId")
  get(@Param("slugOrId") slugOrId: string, @CurrentUser() user?: RequestUser) {
    return this.listings.get(slugOrId, user?.id);
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
