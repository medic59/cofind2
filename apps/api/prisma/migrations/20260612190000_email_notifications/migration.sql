-- Email verification token on User
ALTER TABLE "User" ADD COLUMN "emailVerificationTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);

-- Notification settings + unsubscribe token on UserPreferences
ALTER TABLE "UserPreferences" ADD COLUMN "emailOnResponse" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserPreferences" ADD COLUMN "emailOnMessage" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserPreferences" ADD COLUMN "unsubscribeToken" TEXT;
CREATE UNIQUE INDEX "UserPreferences_unsubscribeToken_key" ON "UserPreferences"("unsubscribeToken");

-- Per-user, per-type notification-email throttle/grouping state
CREATE TABLE "EmailDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "firstPendingAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailDigest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailDigest_userId_type_key" ON "EmailDigest"("userId", "type");
ALTER TABLE "EmailDigest" ADD CONSTRAINT "EmailDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grandfather existing users: they predate the verification gate, so treat them
-- as already verified to avoid locking them out of publishing/DMs.
UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE "emailVerifiedAt" IS NULL;
