import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatRealtimeService } from "./chat-realtime.service";

@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatRealtimeService],
  exports: [ChatRealtimeService, ChatService]
})
export class ChatModule {}

