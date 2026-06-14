import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsRangeDto, CollectEventDto } from "./dto";

@ApiTags("Analytics")
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  // Public, unauthenticated beacon. Cookieless; the client sends only a path,
  // event type and (optional) referrer. Generous but bounded rate limit so a
  // fast SPA navigator is never blocked yet stat-stuffing is capped.
  @Post("collect")
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  async collect(@Body() dto: CollectEventDto, @Req() req: any) {
    const ip = String(req?.ip || req?.socket?.remoteAddress || "");
    const userAgent = String(req?.headers?.["user-agent"] || "");
    await this.analytics.collect(dto, ip, userAgent);
  }

  @Get("summary")
  @ApiBearerAuth()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  summary(@Query() query: AnalyticsRangeDto) {
    return this.analytics.summary(query.days ?? 30);
  }
}
