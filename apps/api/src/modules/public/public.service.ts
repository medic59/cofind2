import { Injectable } from "@nestjs/common";
import { AdPosition } from "@prisma/client";
import { isMonetizationEnabled, publicFeatureFlags } from "../../common/system-settings";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PublicService {
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
      take: 5000
    });
  }
}

function normalizePath(value: string) {
  const path = value.trim() || "/";
  return path.startsWith("/") ? path : `/${path}`;
}
