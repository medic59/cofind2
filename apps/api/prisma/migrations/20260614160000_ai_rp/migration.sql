-- AI co-player (RP) sessions + messages.
CREATE TABLE "AiRpSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fandom" TEXT,
    "character" TEXT,
    "userRole" TEXT,
    "style" TEXT,
    "tempo" TEXT,
    "setting" TEXT,
    "boundaries" TEXT,
    "ageRating" TEXT NOT NULL DEFAULT 'TEEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiRpSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiRpSession_userId_updatedAt_idx" ON "AiRpSession"("userId", "updatedAt");

CREATE TABLE "AiRpMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiRpMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiRpMessage_sessionId_createdAt_idx" ON "AiRpMessage"("sessionId", "createdAt");
ALTER TABLE "AiRpMessage" ADD CONSTRAINT "AiRpMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiRpSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
