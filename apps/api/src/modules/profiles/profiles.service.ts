import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PublicProfileQueryDto } from "./dto";

const profileListingInclude = {
  tags: { include: { tag: true } },
  genres: { include: { genre: true } },
  fandoms: { include: { fandom: true } },
  characters: { include: { character: true } },
  _count: { select: { responses: true, reports: true } }
} satisfies Prisma.ListingInclude;

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async publicProfile(username: string, query: PublicProfileQueryDto = {}) {
    const pagination = this.pagination(query);
    const profile = await this.prisma.profile.findFirst({
      where: {
        username: username.toLowerCase(),
        user: { status: { notIn: ["BANNED", "TEMP_BANNED", "DELETED"] } }
      },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            status: true,
            isPremium: true,
            lastSeenAt: true,
            createdAt: true
          }
        }
      }
    });
    if (!profile) throw new NotFoundException("Profile not found");
    const privacy = profile.privacySettings && typeof profile.privacySettings === "object" && !Array.isArray(profile.privacySettings)
      ? profile.privacySettings as Record<string, unknown>
      : {};
    const showLastSeen = privacy.showLastSeen !== false;
    const allowProfileMessages = privacy.allowProfileMessages !== false;
    const baseListingWhere: Prisma.ListingWhereInput = {
      authorId: profile.user.id,
      status: "PUBLISHED",
      moderationStatus: "APPROVED"
    };
    const filteredListingWhere: Prisma.ListingWhereInput = {
      ...baseListingWhere,
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { body: { contains: query.q, mode: "insensitive" } },
              { tags: { some: { tag: { name: { contains: query.q, mode: "insensitive" } } } } },
              { genres: { some: { genre: { name: { contains: query.q, mode: "insensitive" } } } } },
              { fandoms: { some: { fandom: { name: { contains: query.q, mode: "insensitive" } } } } },
              { characters: { some: { character: { name: { contains: query.q, mode: "insensitive" } } } } }
            ]
          }
        : {})
    };
    const [totalListings, allListingIds, filteredTotal, responseCounts, reportCounts, pageListings] = await Promise.all([
      this.prisma.listing.count({ where: baseListingWhere }),
      this.prisma.listing.findMany({ where: baseListingWhere, select: { id: true } }),
      this.prisma.listing.count({ where: filteredListingWhere }),
      this.prisma.listingResponse.groupBy({
        by: ["listingId"],
        where: { listing: baseListingWhere },
        _count: { _all: true }
      }),
      this.prisma.report.groupBy({
        by: ["listingId"],
        where: { listing: baseListingWhere },
        _count: { _all: true }
      }),
      this.profileListingsPage(filteredListingWhere, query.sort || "new", pagination)
    ]);
    const listingIds = pageListings.map((listing) => listing.id);
    const allIds = allListingIds.map((listing) => listing.id);
    const [likeCounts, allLikeCounts] = await Promise.all([
      listingIds.length
        ? this.prisma.like.groupBy({
            by: ["entityId"],
            where: { entityType: "LISTING", entityId: { in: listingIds } },
            _count: { _all: true }
          })
        : [],
      allIds.length
        ? this.prisma.like.groupBy({
            by: ["entityId"],
            where: { entityType: "LISTING", entityId: { in: allIds } },
            _count: { _all: true }
          })
        : []
    ]);
    const responsesById = new Map(responseCounts.map((item) => [item.listingId, item._count._all]));
    const reportsById = new Map(reportCounts.map((item) => [item.listingId || "", item._count._all]));
    const totalLikes = allLikeCounts.reduce((sum, item) => sum + item._count._all, 0);
    const totalResponses = responseCounts.reduce((sum, item) => sum + item._count._all, 0);
    const totalReports = reportCounts.reduce((sum, item) => sum + item._count._all, 0);
    const likesById = new Map(likeCounts.map((item) => [item.entityId, item._count._all]));
    const listings = pageListings.map((listing) => ({
      ...listing,
      likes: likesById.get(listing.id) || 0,
      responses: responsesById.get(listing.id) || listing._count.responses,
      reports: reportsById.get(listing.id) || listing._count.reports
    }));
    const totalPages = Math.max(1, Math.ceil(filteredTotal / pagination.pageSize));
    return {
      ...profile,
      stats: {
        listings: totalListings,
        likes: totalLikes,
        responses: totalResponses,
        reports: totalReports,
        memberSince: profile.user.createdAt
      },
      listingsPagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: filteredTotal,
        totalPages,
        q: query.q || "",
        sort: query.sort || "new"
      },
      privacy: {
        showLastSeen,
        allowProfileMessages
      },
      user: {
        ...profile.user,
        lastSeenAt: showLastSeen ? profile.user.lastSeenAt : null,
        canMessage: allowProfileMessages,
        listings
      }
    };
  }

  private async profileListingsPage(where: Prisma.ListingWhereInput, sort: string, pagination: { page: number; pageSize: number; skip: number }) {
    if (sort === "popular" || sort === "responses") {
      const candidates = await this.prisma.listing.findMany({
        where,
        select: {
          id: true,
          publishedAt: true,
          _count: { select: { responses: true } }
        }
      });
      const likeCounts = candidates.length
        ? await this.prisma.like.groupBy({
            by: ["entityId"],
            where: { entityType: "LISTING", entityId: { in: candidates.map((listing) => listing.id) } },
            _count: { _all: true }
          })
        : [];
      const likesById = new Map(likeCounts.map((item) => [item.entityId, item._count._all]));
      const publishedTime = (value: Date | null) => value?.getTime() || 0;
      const pageIds = candidates
        .sort((a, b) => {
          if (sort === "popular") {
            const likesDiff = (likesById.get(b.id) || 0) - (likesById.get(a.id) || 0);
            if (likesDiff) return likesDiff;
          } else {
            const responsesDiff = (b._count.responses || 0) - (a._count.responses || 0);
            if (responsesDiff) return responsesDiff;
          }
          return publishedTime(b.publishedAt) - publishedTime(a.publishedAt);
        })
        .slice(pagination.skip, pagination.skip + pagination.pageSize)
        .map((listing) => listing.id);
      if (!pageIds.length) return [];
      const rows = await this.prisma.listing.findMany({
        where: { id: { in: pageIds } },
        include: profileListingInclude
      });
      const order = new Map(pageIds.map((id, index) => [id, index]));
      return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    return this.prisma.listing.findMany({
      where,
      include: profileListingInclude,
      orderBy: { publishedAt: "desc" },
      skip: pagination.skip,
      take: pagination.pageSize
    });
  }

  private pagination(query: PublicProfileQueryDto) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)));
    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize
    };
  }
}
