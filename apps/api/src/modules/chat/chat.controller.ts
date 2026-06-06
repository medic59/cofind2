import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { rateLimit } from "../../common/rate-limit";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { ChatService } from "./chat.service";
import { ReactMessageDto, SendGlobalMessageDto } from "./dto";

@ApiTags("Global Chat")
@Controller("chat")
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Public()
  @Get("messages")
  messages(@Query("cursor") cursor?: string, @Query("room") room?: string, @CurrentUser() user?: RequestUser) {
    return this.chat.messages(cursor, user?.id, room);
  }

  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(45) } })
  @Post("messages")
  send(@CurrentUser() user: RequestUser, @Body() dto: SendGlobalMessageDto) {
    return this.chat.send(user.id, dto);
  }

  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(80) } })
  @Post("messages/:id/react")
  react(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: ReactMessageDto) {
    return this.chat.react(user.id, id, dto);
  }

  @ApiBearerAuth()
  @Throttle({ default: { ttl: 60_000, limit: rateLimit(80) } })
  @Post("messages/:id/like")
  like(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.chat.like(user.id, id);
  }

  @ApiBearerAuth()
  @Delete("messages/:id")
  deleteOwn(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.chat.deleteOwn(user.id, id);
  }
}
