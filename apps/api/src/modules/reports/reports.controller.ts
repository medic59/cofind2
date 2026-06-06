import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PageQueryDto } from "../../common/page-query.dto";
import { rateLimit } from "../../common/rate-limit";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { CreateReportDto } from "./dto";
import { ReportsService } from "./reports.service";

@ApiTags("Reports")
@ApiBearerAuth()
@Controller("reports")
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Throttle({ default: { ttl: 60_000, limit: rateLimit(10) } })
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user.id, dto);
  }

  @Get("my")
  my(@CurrentUser() user: RequestUser, @Query() query: PageQueryDto) {
    return this.reports.my(user.id, query);
  }
}
