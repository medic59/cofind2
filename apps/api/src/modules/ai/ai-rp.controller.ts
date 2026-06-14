import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { AiService } from "./ai.service";
import { CreateRpSessionDto, RpMessageDto } from "./dto";

@ApiTags("AI")
@ApiBearerAuth()
@Controller("ai/rp")
@UseGuards(AuthGuard)
export class AiRpController {
  constructor(private readonly ai: AiService) {}

  @Get("sessions")
  list(@CurrentUser() user: RequestUser) {
    return this.ai.listRpSessions(user.id);
  }

  @Post("sessions")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateRpSessionDto) {
    return this.ai.createRpSession(user.id, dto);
  }

  @Get("sessions/:id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.ai.getRpSession(user.id, id);
  }

  @Post("sessions/:id/message")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  message(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: RpMessageDto) {
    return this.ai.sendRpMessage(user.id, id, dto.content);
  }

  @Delete("sessions/:id")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.ai.deleteRpSession(user.id, id);
  }
}
