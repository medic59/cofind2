import { Injectable } from "@nestjs/common";
import { AdPosition } from "@prisma/client";
import { isMonetizationEnabled, publicFeatureFlags } from "../../common/system-settings";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PublicService {
  private sitemapCache: { at: number; data: SitemapData } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  settings() {
    return publicFeatureFlags(this.prisma);
  }

  async plans() {
    if (!(await isMonetizationEnabled(this.prisma))) return [];
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceCents: "asc" }
    });
  }

  async ads(position?: AdPosition) {
    const now = new Date();
    const placements = await this.prisma.adPlacement.findMany({
      where: {
        status: "ACTIVE",
        ...(position ? { position } : {}),
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }]
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return placements.filter((placement) => placement.impressionLimit == null || placement.impressions < placement.impressionLimit).slice(0, 20);
  }

  seoPage(path: string) {
    return this.prisma.seoPage.findUnique({
      where: { path: normalizePath(path) }
    });
  }

  // Approved catalog entities (slug + updatedAt) for the dynamic sitemap.
  async sitemapCatalog() {
    const [fandoms, genres, tags] = await Promise.all([
      this.prisma.fandom.findMany({ where: { status: "APPROVED" }, select: { slug: true, updatedAt: true }, orderBy: { name: "asc" }, take: SITEMAP_GROUP_LIMIT }),
      this.prisma.genre.findMany({ where: { status: "APPROVED" }, select: { slug: true, updatedAt: true }, orderBy: { name: "asc" }, take: SITEMAP_GROUP_LIMIT }),
      this.prisma.tag.findMany({ where: { status: "APPROVED" }, select: { slug: true, updatedAt: true }, orderBy: { name: "asc" }, take: SITEMAP_GROUP_LIMIT })
    ]);
    return { fandoms, genres, tags };
  }

  // Published, approved listings from visible authors — for the dynamic sitemap.
  sitemapListings() {
    return this.prisma.listing.findMany({
      where: {
        status: "PUBLISHED",
        moderationStatus: "APPROVED",
        author: { status: { notIn: ["BANNED", "TEMP_BANNED", "DELETED"] } }
      },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: SITEMAP_GROUP_LIMIT
    });
  }

  // Public profiles of visible users (/profile/<username>) for the dynamic sitemap.
  sitemapProfiles() {
    return this.prisma.profile.findMany({
      where: { user: { status: { notIn: ["BANNED", "TEMP_BANNED", "DELETED"] } } },
      select: { username: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: SITEMAP_GROUP_LIMIT
    });
  }

  // All sitemap data, cached in-memory for 1 hour (per API instance). Listings,
  // catalog entities and profiles are read together so the rendered sitemap and
  // sitemap-index stay consistent within a cache window.
  async sitemapData(): Promise<SitemapData> {
    const now = Date.now();
    if (this.sitemapCache && now - this.sitemapCache.at < SITEMAP_TTL_MS) return this.sitemapCache.data;
    const [listings, catalog, profiles] = await Promise.all([
      this.sitemapListings(),
      this.sitemapCatalog(),
      this.sitemapProfiles()
    ]);
    const data: SitemapData = {
      listings,
      fandoms: catalog.fandoms,
      genres: catalog.genres,
      tags: catalog.tags,
      profiles
    };
    this.sitemapCache = { at: now, data };
    return data;
  }
}

export type SlugDated = { slug: string; updatedAt: Date };
export type UsernameDated = { username: string; updatedAt: Date };
export type SitemapData = {
  listings: SlugDated[];
  fandoms: SlugDated[];
  genres: SlugDated[];
  tags: SlugDated[];
  profiles: UsernameDated[];
};

const SITEMAP_TTL_MS = 60 * 60 * 1000; // 1 hour
const SITEMAP_GROUP_LIMIT = 50000; // sitemaps.org per-file URL cap

function normalizePath(value: string) {
  const path = value.trim() || "/";
  return path.startsWith("/") ? path : `/${path}`;
}
