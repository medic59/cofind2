-- First-party cookieless web analytics (one row per pageview/event).
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrerHost" TEXT,
    "visitorDay" TEXT NOT NULL,
    "isMobile" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");
CREATE INDEX "AnalyticsEvent_path_createdAt_idx" ON "AnalyticsEvent"("path", "createdAt");
CREATE INDEX "AnalyticsEvent_visitorDay_idx" ON "AnalyticsEvent"("visitorDay");
