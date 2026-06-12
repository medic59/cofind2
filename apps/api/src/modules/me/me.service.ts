import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PageQueryDto } from "../../common/page-query.dto";
import { paged, pagination } from "../../common/pagination";
import { isMonetizationEnabled } from "../../common/system-settings";
import { PrismaService } from "../prisma/prisma.service";
import { deleteUploadedImageIfReplaced } from "../uploads/upload-storage";
import { BlockUserDto, CheckoutDto, CreateBackgroundDto, UpdatePreferencesDto } from "./dto";

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async preferences(userId: string) {
    const prefs = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {}
    });
    return this.hidePrivatePrefs(prefs);
  }

  // The unsubscribe token is a capability secret — never return it to the client.
  private hidePrivatePrefs<T extends { unsubscribeToken?: unknown }>(prefs: T): T {
    if (prefs) delete (prefs as { unsubscribeToken?: unknown }).unsubscribeToken;
    return prefs;
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const previous = dto.dashboardBackgroundImage !== undefined
      ? await this.prisma.userPreferences.findUnique({
          where: { userId },
          select: { dashboardBackgroundImage: true }
        })
      : null;
    const preferences = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto
    });
    if (dto.dashboardBackgroundImage !== undefined) {
      await deleteUploadedImageIfReplaced(previous?.dashboardBackgroundImage, preferences.dashboardBackgroundImage);
    }
    return this.hidePrivatePrefs(preferences);
  }

  async background(userId: string, dto: CreateBackgroundDto) {
    const previous = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { dashboardBackgroundImage: true }
    });
    const preferences = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        dashboardBackgroundType: "image",
        dashboardBackgroundImage: dto.imageUrl,
        dashboardBackgroundPosition: dto.position || "center",
        dashboardBackgroundOverlay: dto.overlay ?? 20,
        dashboardBackgroundBlur: dto.blur ?? 0
      },
      update: {
        dashboardBackgroundType: "image",
        dashboardBackgroundImage: dto.imageUrl,
        dashboardBackgroundPosition: dto.position || "center",
        dashboardBackgroundOverlay: dto.overlay,
        dashboardBackgroundBlur: dto.blur
      }
    });
    await deleteUploadedImageIfReplaced(previous?.dashboardBackgroundImage, preferences.dashboardBackgroundImage);
    return this.hidePrivatePrefs(preferences);
  }

  async clearBackground(userId: string) {
    const previous = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { dashboardBackgroundImage: true }
    });
    const preferences = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        dashboardBackgroundType: "plain",
        dashboardBackgroundImage: null,
        dashboardBackgroundOverlay: 20,
        dashboardBackgroundBlur: 0,
        dashboardBackgroundPosition: "center"
      },
      update: {
        dashboardBackgroundType: "plain",
        dashboardBackgroundImage: null,
        dashboardBackgroundOverlay: 20,
        dashboardBackgroundBlur: 0,
        dashboardBackgroundPosition: "center"
      }
    });
    await deleteUploadedImageIfReplaced(previous?.dashboardBackgroundImage, null);
    return this.hidePrivatePrefs(preferences);
  }

  async subscription(userId: string) {
    if (!(await isMonetizationEnabled(this.prisma))) {
      return { enabled: false, subscription: null };
    }
    return this.prisma.userSubscription.findUnique({
      where: { userId },
      include: { plan: true }
    });
  }

  async checkout(userId: string, dto: CheckoutDto) {
    if (!(await isMonetizationEnabled(this.prisma))) {
      throw new ForbiddenException("Paid features are not enabled yet");
    }
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { code: dto.planCode } });
    if (!plan || !plan.isActive) throw new NotFoundException("Subscription plan not found");

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        planId: plan.id,
        provider: "manual-dev",
        amountCents: plan.priceCents,
        currency: plan.currency,
        status: "PENDING",
        metadata: { nextAction: "connect real payment provider" }
      }
    });
    return { checkoutUrl: `/dev/payments/${payment.id}`, payment };
  }

  async cancelSubscription(userId: string) {
    if (!(await isMonetizationEnabled(this.prisma))) {
      throw new ForbiddenException("Paid features are not enabled yet");
    }
    const subscription = await this.prisma.userSubscription.findUnique({
      where: { userId },
      include: { plan: true }
    });
    if (!subscription) throw new NotFoundException("Subscription not found");
    if (subscription.status === "CANCELED") {
      return { subscription, canceled: false };
    }

    const canceled = await this.prisma.userSubscription.update({
      where: { userId },
      data: {
        status: "CANCELED",
        canceledAt: new Date()
      },
      include: { plan: true }
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { isPremium: false }
    });
    await this.prisma.notification.create({
      data: {
        userId,
        type: "SYSTEM",
        title: "Premium отменен",
        description: "Подписка отключена. Вы можете оформить Premium снова в любой момент.",
        linkPath: "/me/subscription"
      }
    });
    return { subscription: canceled, canceled: true };
  }

  async payments(userId: string, query: PageQueryDto = {}) {
    if (query.page === undefined && query.pageSize === undefined) {
      return this.prisma.payment.findMany({
        where: { userId },
        include: { plan: true },
        orderBy: { createdAt: "desc" }
      });
    }
    const page = pagination(query);
    const [total, hits] = await Promise.all([
      this.prisma.payment.count({ where: { userId } }),
      this.prisma.payment.findMany({
        where: { userId },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.pageSize
      })
    ]);
    return paged(hits, total, page);
  }

  notifications(userId: string, query: PageQueryDto = {}) {
    if (query.page === undefined && query.pageSize === undefined) {
      return this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 100
      });
    }
    const page = pagination(query);
    return this.prisma.$transaction([
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.pageSize
      })
    ]).then(([total, hits]) => paged(hits, total, page));
  }

  async likedListings(userId: string, query: PageQueryDto = {}) {
    const isPaged = query.page !== undefined || query.pageSize !== undefined;
    const page = pagination(query);
    if (!isPaged) {
      const likes = await this.prisma.like.findMany({
        where: { userId, entityType: "LISTING" },
        orderBy: { createdAt: "desc" },
        take: 50
      });
      return this.likedListingsByLikes(userId, likes);
    }
    const likes = await this.prisma.like.findMany({
      where: { userId, entityType: "LISTING" },
      orderBy: { createdAt: "desc" },
      select: { entityId: true }
    });
    const visible = await this.visibleListingIds(likes.map((like) => like.entityId));
    const visibleLikes = likes.filter((like) => visible.has(like.entityId));
    const pageLikes = visibleLikes.slice(page.skip, page.skip + page.pageSize);
    const listings = await this.likedListingsByLikes(userId, pageLikes);
    return paged(listings, visibleLikes.length, page);
  }

  private async visibleListingIds(ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await this.prisma.listing.findMany({
      where: {
        id: { in: ids },
        status: "PUBLISHED",
        moderationStatus: "APPROVED",
        author: { status: { notIn: ["BANNED", "TEMP_BANNED", "DELETED"] } }
      },
      select: { id: true }
    });
    return new Set(rows.map((row) => row.id));
  }

  private async likedListingsByLikes(userId: string, likes: Array<{ entityId: string }>) {
    const ids = likes.map((like) => like.entityId);
    if (!ids.length) return [];
    const listings = await this.prisma.listing.findMany({
      where: {
        id: { in: ids },
        status: "PUBLISHED",
        moderationStatus: "APPROVED",
        author: { status: { notIn: ["BANNED", "TEMP_BANNED", "DELETED"] } }
      },
      include: {
        author: { select: { id: true, profile: true, role: true, status: true, isPremium: true } },
        tags: { include: { tag: true } },
        genres: { include: { genre: true } },
        fandoms: { include: { fandom: true } },
        characters: { include: { character: true } },
        _count: { select: { responses: true, reports: true } }
      }
    });
    const order = new Map(ids.map((id, index) => [id, index]));
    const likeCounts = await this.prisma.like.groupBy({
      by: ["entityId"],
      where: { entityType: "LISTING", entityId: { in: listings.map((listing) => listing.id) } },
      _count: { _all: true }
    });
    const counts = new Map(likeCounts.map((item) => [item.entityId, item._count._all]));
    return listings
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((listing) => ({
        ...listing,
        likes: counts.get(listing.id) || 0,
        likedByMe: true,
        responses: listing._count.responses,
        reports: listing._count.reports
      }));
  }

  async exportData(userId: string) {
    const [
      user,
      listings,
      responsesSent,
      conversations,
      globalMessages,
      likes,
      drawings,
      notifications,
      reportsSubmitted,
      blocks,
      payments,
      suggestions
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          isPremium: true,
          emailVerifiedAt: true,
          lastSeenAt: true,
          createdAt: true,
          updatedAt: true,
          profile: true,
          preferences: true,
          subscription: { include: { plan: true } }
        }
      }),
      this.prisma.listing.findMany({
        where: { authorId: userId },
        include: {
          meta: true,
          tags: { include: { tag: true } },
          genres: { include: { genre: true } },
          fandoms: { include: { fandom: true } },
          characters: { include: { character: true } },
          responses: { include: { sender: { select: { id: true, profile: true } } }, orderBy: { createdAt: "desc" } }
        },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.listingResponse.findMany({
        where: { senderId: userId },
        include: { listing: { select: { id: true, slug: true, title: true, authorId: true, status: true } } },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.conversation.findMany({
        where: { participants: { some: { userId } } },
        include: {
          participants: { include: { user: { select: { id: true, role: true, status: true, profile: true } } } },
          messages: {
            include: {
              sender: { select: { id: true, profile: true } },
              reactions: true,
              quotesAsMessage: true,
              drawings: true
            },
            orderBy: { createdAt: "asc" }
          }
        },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.globalChatMessage.findMany({
        where: { senderId: userId },
        include: {
          reactions: true,
          quotesAsMessage: true,
          drawings: true
        },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.like.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      this.prisma.canvasDrawing.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      this.prisma.report.findMany({ where: { reporterId: userId }, orderBy: { createdAt: "desc" } }),
      this.prisma.userBlock.findMany({
        where: { blockerId: userId },
        include: { blocked: { select: { id: true, role: true, status: true, profile: true } } },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.payment.findMany({ where: { userId }, include: { plan: true }, orderBy: { createdAt: "desc" } }),
      this.prisma.moderationSuggestion.findMany({ where: { authorId: userId }, orderBy: { createdAt: "desc" } })
    ]);
    if (!user) throw new NotFoundException("User not found");

    return {
      exportedAt: new Date().toISOString(),
      user,
      listings,
      responsesSent,
      conversations,
      globalMessages,
      likes,
      drawings,
      notifications,
      reportsSubmitted,
      blocks,
      payments,
      suggestions
    };
  }

  async readNotification(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!notification) throw new NotFoundException("Notification not found");
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true }
    });
  }

  readAllNotifications(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });
  }

  blocks(userId: string) {
    return this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: { id: true, profile: true, role: true, status: true } } },
      orderBy: { createdAt: "desc" }
    });
  }

  async block(userId: string, dto: BlockUserDto) {
    if (userId === dto.userId) throw new BadRequestException("You cannot block yourself");
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true } });
    if (!target) throw new NotFoundException("User not found");
    return this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: dto.userId } },
      create: { blockerId: userId, blockedId: dto.userId },
      update: {}
    });
  }

  async unblock(userId: string, blockedId: string) {
    const result = await this.prisma.userBlock.deleteMany({
      where: { blockerId: userId, blockedId }
    });
    return { unblocked: result.count > 0 };
  }
}
