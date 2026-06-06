import { Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SearchListingsQueryDto } from "./dto";
import { SearchService } from "./search.service";

@ApiTags("Search")
@Controller("search")
@UseGuards(AuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get("listings")
  listings(@Query() query: SearchListingsQueryDto, @CurrentUser() user?: RequestUser) {
    return this.search.listings(query, user?.id);
  }

  @ApiBearerAuth()
  @Post("reindex")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  reindex() {
    return this.search.reindexListings();
  }
}
