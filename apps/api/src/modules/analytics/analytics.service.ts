import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CollectEventDto } from "./dto";

// Non-pageview events we accept. Anything else is dropped so `type` can never
// become an attacker-controlled high-cardinality column.
const ALLOWED_EVENTS = new Set(["register", "listing_created", "response_sent", "subscription_started"]);

// High-cardinality detail routes collapsed to a template so "top pages" stays
// meaningful instead of one row per slug.
const DETAIL_ROUTES: Array<[string, string]> = [
  ["/listings/", "/listing/:id"],
  ["/listing/", "/listing/:id"],
  ["/profile/", "/profile/:username"],
  ["/fandoms/", "/fandoms/:slug"],
  ["/genres/", "/genres/:slug"],
  ["/tags/", "/tags/:slug"],
];

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizePath(raw: string) {
    let path = String(raw || "/").split("?")[0].split("#")[0].trim();
    if (!path.startsWith("/")) path = `/${path}`;
    path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    for (const [prefix, template] of DETAIL_ROUTES) {
      if (path.startsWith(prefix) && path.length > prefix.length) return template;
    }
    return path.slice(0, 120);
  }

  private referrerHost(referrer: string | undefined, ownHost: string) {
    if (!referrer) return null;
    try {
      const host = new URL(referrer).hostname.toLowerCase();
      if (!host || host === ownHost) return null;
      return host.slice(0, 120);
    } catch {
      return null;
    }
  }

  // Salted daily hash of ip+ua. The date is part of the input, so the value
  // rotates every day and cannot be linked across days; the secret makes it
  // non-reversible despite the tiny ip/ua space.
  private visitorDay(ip: string, userAgent: string) {
    const day = new Date().toISOString().slice(0, 10);
    const secret = process.env.ANALYTICS_SALT || process.env.JWT_REFRESH_SECRET || "cofind-analytics";
    return createHash("sha256").update(`${day}|${ip}|${userAgent}|${secret}`).digest("hex").slice(0, 32);
  }

  async collect(dto: CollectEventDto, ip: string, userAgent: string) {
    const type = dto.type === "pageview" ? "pageview" : dto.type;
    if (type !== "pageview" && !ALLOWED_EVENTS.has(type)) return;
    const ownHost = (() => {
      try {
        return new URL(String(process.env.PUBLIC_WEB_URL || "").split(",")[0].trim()).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    await this.prisma.analyticsEvent.create({
      data: {
        type,
        path: this.normalizePath(dto.path),
        referrerHost: this.referrerHost(dto.referrer, ownHost),
        visitorDay: this.visitorDay(ip || "", userAgent || ""),
        isMobile: /Mobi|Android|iPhone|iPad/i.test(userAgent || ""),
      },
    });
  }

  async summary(days: number) {
    const span = Math.min(365, Math.max(1, Math.floor(days) || 30));
    const start = new Date(Date.now() - span * 24 * 60 * 60 * 1000);

    const [daily, totals, topPages, topReferrers, topEvents, mobileSplit] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: string; views: bigint; visitors: bigint }>>(Prisma.sql`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(*) FILTER (WHERE "type" = 'pageview') AS views,
               COUNT(DISTINCT "visitorDay") AS visitors
        FROM "AnalyticsEvent"
        WHERE "createdAt" >= ${start}
        GROUP BY 1 ORDER BY 1`),
      this.prisma.$queryRaw<Array<{ views: bigint; visitors: bigint }>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE "type" = 'pageview') AS views,
               COUNT(DISTINCT "visitorDay") AS visitors
        FROM "AnalyticsEvent"
        WHERE "createdAt" >= ${start}`),
      this.prisma.analyticsEvent.groupBy({
        by: ["path"],
        where: { type: "pageview", createdAt: { gte: start } },
        _count: { path: true },
        orderBy: { _count: { path: "desc" } },
        take: 12,
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ["referrerHost"],
        where: { referrerHost: { not: null }, createdAt: { gte: start } },
        _count: { referrerHost: true },
        orderBy: { _count: { referrerHost: "desc" } },
        take: 10,
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ["type"],
        where: { type: { not: "pageview" }, createdAt: { gte: start } },
        _count: { type: true },
        orderBy: { _count: { type: "desc" } },
        take: 12,
      }),
      this.prisma.$queryRaw<Array<{ mobile: bigint; total: bigint }>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE "isMobile") AS mobile, COUNT(*) AS total
        FROM "AnalyticsEvent"
        WHERE "type" = 'pageview' AND "createdAt" >= ${start}`),
    ]);

    const num = (value: bigint | number | null | undefined) => Number(value ?? 0);
    return {
      days: span,
      totals: { views: num(totals[0]?.views), visitors: num(totals[0]?.visitors) },
      daily: daily.map((row) => ({ day: row.day, views: num(row.views), visitors: num(row.visitors) })),
      topPages: topPages.map((row) => ({ path: row.path, count: num(row._count.path) })),
      topReferrers: topReferrers.map((row) => ({ host: row.referrerHost, count: num(row._count.referrerHost) })),
      topEvents: topEvents.map((row) => ({ type: row.type, count: num(row._count.type) })),
      mobile: { mobile: num(mobileSplit[0]?.mobile), total: num(mobileSplit[0]?.total) },
    };
  }
}
