-- Per-user, per-day AI usage counter (rate/cost control).
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiUsage_userId_feature_day_key" ON "AiUsage"("userId", "feature", "day");
CREATE INDEX "AiUsage_day_idx" ON "AiUsage"("day");
