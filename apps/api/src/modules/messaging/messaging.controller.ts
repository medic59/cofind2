import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser, RequestUser } from "../auth/current-user.decorator";
import { CreateConversationDto, DirectConversationDto, ListConversationMessagesQueryDto, SendMessageDto } from "./dto";
import { MessagingService } from "./messaging.service";

@ApiTags("Messaging")
@ApiBearerAuth()
@Controller("conversations")
@UseGuards(AuthGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateConversationDto) {
    return this.messaging.create(user.id, dto);
  }

  @Post("direct")
  direct(@CurrentUser() user: RequestUser, @Body() dto: DirectConversationDto) {
    return this.messaging.ensureBetween(user.id, dto.participantId, dto.initialMessage);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.messaging.list(user.id);
  }

  @Get(":id/messages")
  messages(@CurrentUser() user: RequestUser, @Param("id") id: string, @Query() query: ListConversationMessagesQueryDto) {
    return this.messaging.messages(user.id, id, query.cursor);
  }

  @Post(":id/messages")
  send(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: SendMessageDto) {
    return this.messaging.send(user.id, id, dto);
  }

  @Delete(":id/messages/:messageId")
  deleteOwn(@CurrentUser() user: RequestUser, @Param("id") id: string, @Param("messageId") messageId: string) {
    return this.messaging.deleteOwn(user.id, id, messageId);
  }

  @Post(":id/read")
  read(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.messaging.read(user.id, id);
  }
}
