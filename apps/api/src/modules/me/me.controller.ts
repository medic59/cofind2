import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PageQueryDto } from "../../common/page-query.dto";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { BlockUserDto, CheckoutDto, CreateBackgroundDto, UpdatePreferencesDto } from "./dto";
import { MeService } from "./me.service";

@ApiTags("Me")
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get("me/preferences")
  preferences(@CurrentUser() user: RequestUser) {
    return this.me.preferences(user.id);
  }

  @Patch("me/preferences")
  updatePreferences(@CurrentUser() user: RequestUser, @Body() dto: UpdatePreferencesDto) {
    return this.me.updatePreferences(user.id, dto);
  }

  @Post("me/background")
  background(@CurrentUser() user: RequestUser, @Body() dto: CreateBackgroundDto) {
    return this.me.background(user.id, dto);
  }

  @Delete("me/background")
  clearBackground(@CurrentUser() user: RequestUser) {
    return this.me.clearBackground(user.id);
  }

  @Get("me/subscription")
  subscription(@CurrentUser() user: RequestUser) {
    return this.me.subscription(user.id);
  }

  @Post("me/subscription/checkout")
  checkout(@CurrentUser() user: RequestUser, @Body() dto: CheckoutDto) {
    return this.me.checkout(user.id, dto);
  }

  @Post("me/subscription/cancel")
  cancelSubscription(@CurrentUser() user: RequestUser) {
    return this.me.cancelSubscription(user.id);
  }

  @Get("me/payments")
  payments(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.me.payments(user.id, query);
  }

  @Get("me/liked-listings")
  likedListings(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.me.likedListings(user.id, query);
  }

  @Get("me/export")
  exportData(@CurrentUser() user: RequestUser) {
    return this.me.exportData(user.id);
  }

  @Get("notifications")
  notifications(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.me.notifications(user.id, query);
  }

  @Post("notifications/:id/read")
  readNotification(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.me.readNotification(user.id, id);
  }

  @Post("notifications/read-all")
  readAllNotifications(@CurrentUser() user: RequestUser) {
    return this.me.readAllNotifications(user.id);
  }

  @Get("me/blocks")
  blocks(@CurrentUser() user: RequestUser) {
    return this.me.blocks(user.id);
  }

  @Post("me/blocks")
  block(@CurrentUser() user: RequestUser, @Body() dto: BlockUserDto) {
    return this.me.block(user.id, dto);
  }

  @Delete("me/blocks/:userId")
  unblock(@CurrentUser() user: RequestUser, @Param("userId") blockedId: string) {
    return this.me.unblock(user.id, blockedId);
  }
}
