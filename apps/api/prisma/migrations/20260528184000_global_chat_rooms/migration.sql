-- Add real room support to global chat while keeping old messages in the default room.
ALTER TABLE "GlobalChatMessage" ADD COLUMN "room" TEXT NOT NULL DEFAULT 'general';

CREATE INDEX "GlobalChatMessage_room_createdAt_idx" ON "GlobalChatMessage"("room", "createdAt");
