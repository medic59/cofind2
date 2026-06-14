import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { AiService } from "./ai.service";
import { ListingDraftDto } from "./dto";

@ApiTags("AI")
@ApiBearerAuth()
@Controller("ai")
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  // Lets the SPA decide whether to show AI affordances + how much quota is left.
  @Get("status")
  status(@CurrentUser() user: RequestUser) {
    return this.ai.status(user.id);
  }

  // Listing draft assistant. Tight throttle on top of the per-user daily limit.
  @Post("listing/draft")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  draftListing(@CurrentUser() user: RequestUser, @Body() dto: ListingDraftDto) {
    return this.ai.generateListingDraft(user.id, dto);
  }
}
