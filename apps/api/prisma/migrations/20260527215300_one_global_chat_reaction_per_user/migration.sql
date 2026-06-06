DELETE FROM "MessageReaction" loser
USING "MessageReaction" keeper
WHERE loser."globalMessageId" IS NOT NULL
  AND keeper."globalMessageId" = loser."globalMessageId"
  AND keeper."userId" = loser."userId"
  AND (
    keeper."createdAt" > loser."createdAt"
    OR (keeper."createdAt" = loser."createdAt" AND keeper."id" > loser."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "MessageReaction_globalMessageId_userId_key" ON "MessageReaction"("globalMessageId", "userId");
