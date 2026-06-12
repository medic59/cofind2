import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ListingStatus, ModerationStatus, Prisma } from "@prisma/client";
import { PageQueryDto } from "../../common/page-query.dto";
import { paged, pagination } from "../../common/pagination";
import { sanitizeRichText, richPlainTextLength, richTextLength } from "../../common/rich-text";
import { MessagingService } from "../messaging/messaging.service";
import { NotificationEmailService } from "../notifications/notification-email.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateListingDto, ListListingsQueryDto, RespondListingDto, UpdateListingDto, UpdateResponseStatusDto } from "./dto";

const includeListing = {
  author: { select: { id: true, profile: true, role: true, status: true, isPremium: true } },
  meta: true,
  tags: { include: { tag: true } },
  genres: { include: { genre: true } },
  fandoms: { include: { fandom: true } },
  characters: { include: { character: true } },
  _count: { select: { responses: true, reports: true } }
} satisfies Prisma.ListingInclude;

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly notificationEmail: NotificationEmailService
  ) {}

  async list(query: ListListingsQueryDto, viewerId?: string) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? query.limit ?? 20)));
    const skip = (page - 1) * pageSize;
    const where: Prisma.ListingWhereInput = {
      status: ListingStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      author: publicAuthorWhere(),
      ...(query.type ? { type: query.type } : {}),
      ...(query.ageRating ? { ageRating: query.ageRating } : {}),
      ...(query.tag ? { tags: { some: { tag: this.catalogQuery(query.tag) } } } : {}),
      ...(query.genre ? { genres: { some: { genre: this.catalogQuery(query.genre) } } } : {}),
      ...(query.fandom ? { fandoms: { some: { fandom: this.catalogQuery(query.fandom) } } } : {}),
      ...(query.character ? { characters: { some: { character: this.catalogQuery(query.character) } } } : {})
    };
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: "insensitive" } },
        { body: { contains: query.q, mode: "insensitive" } },
        { author: { profile: { username: { contains: query.q, mode: "insensitive" } } } }
      ];
    }
    const [total, listings] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        include: includeListing,
        orderBy: { publishedAt: "desc" },
        skip,
        take: pageSize
      })
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: await this.withListingMetrics(listings, viewerId),
      total,
      page,
      pageSize,
      totalPages,
      nextPage: page < totalPages ? page + 1 : null
    };
  }

  async get(slugOrId: string, viewerId?: string) {
    const listing = await this.prisma.listing.findFirst({
      where: {
        OR: [{ id: slugOrId }, { slug: slugOrId }],
        status: ListingStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        author: publicAuthorWhere()
      },
      include: includeListing
    });
    if (!listing) throw new NotFoundException("Listing not found");
    return this.withListingMetrics(listing, viewerId);
  }

  async mine(authorId: string, query: PageQueryDto = {}) {
    const isPaged = query.page !== undefined || query.pageSize !== undefined;
    const page = pagination(query);
    if (isPaged) {
      const where: Prisma.ListingWhereInput = { authorId, status: { not: "DELETED" } };
      const [total, listings] = await Promise.all([
        this.prisma.listing.count({ where }),
        this.prisma.listing.findMany({
          where,
          include: includeListing,
          orderBy: { updatedAt: "desc" },
          skip: page.skip,
          take: page.pageSize
        })
      ]);
      return paged(await this.withListingMetrics(listings, authorId), total, page);
    }
    const listings = await this.prisma.listing.findMany({
      where: { authorId, status: { not: "DELETED" } },
      include: includeListing,
      orderBy: { updatedAt: "desc" },
      take: 100
    });
    return this.withListingMetrics(listings, authorId);
  }

  async getMine(authorId: string, id: string) {
    const listing = await this.prisma.listing.findFirst({
      where: { id, authorId, status: { not: "DELETED" } },
      include: includeListing
    });
    if (!listing) throw new NotFoundException("Listing not found");
    return this.withListingMetrics(listing, authorId);
  }

  async create(authorId: string, dto: CreateListingDto) {
    const slug = await this.uniqueSlug(dto.title);
    const catalog = await this.prepareCatalogRelations(dto);
    const body = this.safeRichText(dto.body, 20, "Listing body");
    const listing = await this.prisma.listing.create({
      data: {
        authorId,
        type: dto.type,
        title: dto.title,
        slug,
        body,
        ageRating: dto.ageRating || "EVERYONE",
        fandomMode: dto.fandomMode || "ORIGINAL",
        status: "DRAFT",
        moderationStatus: "PENDING",
        meta: { create: {} },
        tags: catalog.tagSlugs?.length
          ? { create: catalog.tagSlugs.map((slugValue) => ({ tag: { connect: { slug: slugValue } } })) }
          : undefined,
        genres: catalog.genreSlugs?.length
          ? { create: catalog.genreSlugs.map((slugValue) => ({ genre: { connect: { slug: slugValue } } })) }
          : undefined,
        fandoms: catalog.fandomSlugs?.length
          ? { create: catalog.fandomSlugs.map((slugValue) => ({ fandom: { connect: { slug: slugValue } } })) }
          : undefined,
        characters: catalog.characterSlugs?.length
          ? { create: catalog.characterSlugs.map((slugValue) => ({ character: { connect: { slug: slugValue } } })) }
          : undefined
      },
      include: includeListing
    });
    return this.withListingMetrics(listing);
  }

  async update(authorId: string, id: string, dto: UpdateListingDto) {
    await this.ensureOwnListing(authorId, id);
    const catalog = await this.prepareCatalogRelations(dto);
    const body = dto.body ? this.safeRichText(dto.body, 20, "Listing body") : undefined;
    const data: Prisma.ListingUpdateInput = {
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.title ? { title: dto.title } : {}),
      ...(body ? { body } : {}),
      ...(dto.ageRating ? { ageRating: dto.ageRating } : {}),
      ...(dto.fandomMode ? { fandomMode: dto.fandomMode } : {}),
      ...(dto.tagSlugs ? { tags: { deleteMany: {}, create: catalog.tagSlugs.map((slug) => ({ tag: { connect: { slug } } })) } } : {}),
      ...(dto.genreSlugs ? { genres: { deleteMany: {}, create: catalog.genreSlugs.map((slug) => ({ genre: { connect: { slug } } })) } } : {}),
      ...(dto.fandomSlugs ? { fandoms: { deleteMany: {}, create: catalog.fandomSlugs.map((slug) => ({ fandom: { connect: { slug } } })) } } : {}),
      ...(dto.characterSlugs ? { characters: { deleteMany: {}, create: catalog.characterSlugs.map((slug) => ({ character: { connect: { slug } } })) } } : {})
    };
    const listing = await this.prisma.listing.update({
      where: { id },
      data,
      include: includeListing
    });
    return this.withListingMetrics(listing);
  }

  async publish(authorId: string, id: string) {
    await this.ensureOwnListing(authorId, id);
    await this.assertEmailVerified(authorId, "публиковать заявки");
    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        moderationStatus: "PENDING",
        publishedAt: new Date()
      },
      include: includeListing
    });
    return this.withListingMetrics(listing);
  }

  async changeStatus(authorId: string, id: string, status: Extract<ListingStatus, "ARCHIVED" | "CLOSED">) {
    await this.ensureOwnListing(authorId, id);
    const listing = await this.prisma.listing.update({
      where: { id },
      data: { status },
      include: includeListing
    });
    return this.withListingMetrics(listing);
  }

  async deleteOwn(authorId: string, id: string) {
    await this.ensureOwnListing(authorId, id);
    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        status: "DELETED",
        moderationStatus: "HIDDEN"
      },
      include: includeListing
    });
    return this.withListingMetrics(listing);
  }

  async respond(senderId: string, listingId: string, dto: RespondListingDto) {
    await this.assertCanCommunicate(senderId);
    const message = this.safeRichText(dto.message, 10, "Response message");
    const listing = await this.prisma.listing.findFirst({
      where: {
        id: listingId,
        status: ListingStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        author: publicAuthorWhere()
      },
      select: { id: true, authorId: true, author: { select: { status: true } } }
    });
    if (!listing) throw new NotFoundException("Listing not found");
    if (listing.authorId === senderId) throw new BadRequestException("You cannot respond to your own listing");
    const existingResponse = await this.prisma.listingResponse.findUnique({
      where: { listingId_senderId: { listingId, senderId } },
      select: { id: true }
    });
    if (existingResponse) throw new BadRequestException("Response already exists");
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: listing.authorId },
          { blockerId: listing.authorId, blockedId: senderId }
        ]
      },
      select: { id: true }
    });
    if (block) throw new ForbiddenException("Interaction is blocked");
    const response = await this.prisma.listingResponse.create({
      data: {
        listingId,
        senderId,
        message
      }
    });
    // Notify the listing author by email (grouped, best-effort, never blocks).
    void this.notificationEmail.queueResponse(listing.authorId);
    return response;
  }

  async myResponses(userId: string, query: PageQueryDto = {}) {
    const isPaged = query.page !== undefined || query.pageSize !== undefined;
    const page = pagination(query);
    if (isPaged) {
      const where: Prisma.ListingResponseWhereInput = { senderId: userId };
      const [total, hits] = await Promise.all([
        this.prisma.listingResponse.count({ where }),
        this.prisma.listingResponse.findMany({
          where,
          include: {
            listing: {
              include: {
                author: { select: { id: true, profile: true } },
                tags: { include: { tag: true } }
              }
            }
          },
          orderBy: { createdAt: "desc" },
          skip: page.skip,
          take: page.pageSize
        })
      ]);
      return paged(hits, total, page);
    }
    return this.prisma.listingResponse.findMany({
      where: { senderId: userId },
      include: {
        listing: {
          include: {
            author: { select: { id: true, profile: true } },
            tags: { include: { tag: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async incomingResponses(userId: string, query: PageQueryDto = {}) {
    const isPaged = query.page !== undefined || query.pageSize !== undefined;
    const page = pagination(query);
    const where: Prisma.ListingResponseWhereInput = { listing: { authorId: userId } };
    const include = {
      sender: { select: { id: true, profile: true, role: true } },
      listing: {
        select: {
          id: true,
          title: true,
          slug: true,
          type: true,
          ageRating: true
        }
      }
    } satisfies Prisma.ListingResponseInclude;
    if (isPaged) {
      const [total, hits] = await Promise.all([
        this.prisma.listingResponse.count({ where }),
        this.prisma.listingResponse.findMany({
          where,
          include,
          orderBy: { createdAt: "desc" },
          skip: page.skip,
          take: page.pageSize
        })
      ]);
      return paged(hits, total, page);
    }
    return this.prisma.listingResponse.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  async listingResponses(userId: string, listingId: string, query: PageQueryDto = {}) {
    const isPaged = query.page !== undefined || query.pageSize !== undefined;
    const page = pagination(query);
    const where: Prisma.ListingResponseWhereInput = {
      listingId,
      listing: { authorId: userId }
    };
    if (isPaged) {
      const [total, hits] = await Promise.all([
        this.prisma.listingResponse.count({ where }),
        this.prisma.listingResponse.findMany({
          where,
          include: { sender: { select: { id: true, profile: true, role: true } } },
          orderBy: { createdAt: "desc" },
          skip: page.skip,
          take: page.pageSize
        })
      ]);
      return paged(hits, total, page);
    }
    return this.prisma.listingResponse.findMany({
      where,
      include: { sender: { select: { id: true, profile: true, role: true } } },
      orderBy: { createdAt: "desc" }
    });
  }

  async updateResponseStatus(userId: string, responseId: string, dto: UpdateResponseStatusDto) {
    const response = await this.prisma.listingResponse.findFirst({
      where: { id: responseId, listing: { authorId: userId } },
      include: { listing: true, sender: { select: { id: true, profile: true } } }
    });
    if (!response) throw new NotFoundException("Response not found");
    if (response.status === dto.status) return response;
    if (response.status !== "NEW") throw new BadRequestException("Response status is already final");
    const updated = await this.prisma.listingResponse.update({
      where: { id: responseId },
      data: { status: dto.status }
    });
    if (dto.status === "ACCEPTED") {
      await this.messaging.ensureBetween(
        userId,
        response.senderId,
        `Отклик на заявку "${response.listing.title}" принят. Можно обсудить детали.`
      );
      await this.prisma.notification.create({
        data: {
          userId: response.senderId,
          type: "RESPONSE_ACCEPTED",
          title: "Отклик принят",
          description: `Ваш отклик на "${response.listing.title}" принят.`,
          linkPath: "/me/inbox"
        }
      });
    }
    if (dto.status === "DECLINED") {
      await this.prisma.notification.create({
        data: {
          userId: response.senderId,
          type: "SYSTEM",
          title: "Отклик отклонен",
          description: `Ваш отклик на "${response.listing.title}" отклонен.`,
          linkPath: "/me/inbox"
        }
      });
    }
    return updated;
  }

  async toggleLike(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, status: ListingStatus.PUBLISHED, moderationStatus: ModerationStatus.APPROVED, author: publicAuthorWhere() },
      select: { id: true }
    });
    if (!listing) throw new NotFoundException("Listing not found");
    const existing = await this.prisma.like.findUnique({
      where: { userId_entityType_entityId: { userId, entityType: "LISTING", entityId: listingId } }
    });
    if (existing) {
      await this.prisma.like.delete({ where: { id: existing.id } });
      return { liked: false, likes: await this.countLikes("LISTING", listingId) };
    }
    await this.prisma.like.create({ data: { userId, entityType: "LISTING", entityId: listingId } });
    return { liked: true, likes: await this.countLikes("LISTING", listingId) };
  }

  private async uniqueSlug(title: string) {
    const base = title
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "listing";
    let slug = base;
    let index = 2;
    while (await this.prisma.listing.findUnique({ where: { slug } })) {
      slug = `${base}-${index++}`;
    }
    return slug;
  }

  private async ensureOwnListing(authorId: string, id: string) {
    const listing = await this.prisma.listing.findFirst({ where: { id, authorId }, select: { id: true } });
    if (!listing) throw new NotFoundException("Listing not found");
  }

  private async assertCanCommunicate(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, emailVerifiedAt: true } });
    if (!user || user.status === "MUTED") throw new ForbiddenException("User is muted");
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ error: "EMAIL_NOT_VERIFIED", message: "Подтвердите e-mail, чтобы откликаться и писать сообщения" });
    }
  }

  private async assertEmailVerified(userId: string, action: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
    if (!user?.emailVerifiedAt) {
      throw new ForbiddenException({ error: "EMAIL_NOT_VERIFIED", message: `Подтвердите e-mail, чтобы ${action}` });
    }
  }

  private countLikes(entityType: string, entityId: string) {
    return this.prisma.like.count({ where: { entityType, entityId } });
  }

  private pagination(query: Pick<ListListingsQueryDto, "page" | "pageSize">) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 12)));
    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize
    };
  }

  private async prepareCatalogRelations(dto: Pick<CreateListingDto, "tagSlugs" | "genreSlugs" | "fandomSlugs" | "characterSlugs">) {
    const catalog = {
      tagSlugs: this.uniqueSlugs(dto.tagSlugs),
      genreSlugs: this.uniqueSlugs(dto.genreSlugs),
      fandomSlugs: this.uniqueSlugs(dto.fandomSlugs),
      characterSlugs: this.uniqueSlugs(dto.characterSlugs)
    };
    await Promise.all([
      this.assertCatalogExists("tag", catalog.tagSlugs),
      this.assertCatalogExists("genre", catalog.genreSlugs),
      this.assertCatalogExists("fandom", catalog.fandomSlugs),
      this.assertCatalogExists("character", catalog.characterSlugs)
    ]);
    return catalog;
  }

  private safeRichText(value: string, minLength: number, label: string) {
    const sanitized = sanitizeRichText(value);
    if (richPlainTextLength(sanitized) < minLength) throw new BadRequestException(`${label} is too short`);
    if (richTextLength(sanitized) > 4000) throw new BadRequestException(`${label} is too long`);
    return sanitized;
  }

  private uniqueSlugs(slugs?: string[]) {
    return [...new Set((slugs || []).map((slug) => slug.trim().toLowerCase()).filter(Boolean))];
  }

  private async assertCatalogExists(kind: "tag" | "genre" | "fandom" | "character", slugs: string[]) {
    if (!slugs.length) return;
    const rows =
      kind === "tag"
        ? await this.prisma.tag.findMany({ where: { slug: { in: slugs }, status: "APPROVED" }, select: { slug: true } })
        : kind === "genre"
          ? await this.prisma.genre.findMany({ where: { slug: { in: slugs }, status: "APPROVED" }, select: { slug: true } })
          : kind === "fandom"
            ? await this.prisma.fandom.findMany({ where: { slug: { in: slugs }, status: "APPROVED" }, select: { slug: true } })
            : await this.prisma.character.findMany({ where: { slug: { in: slugs }, status: "APPROVED" }, select: { slug: true } });
    const existing = new Set(rows.map((row) => row.slug));
    const missing = slugs.filter((slug) => !existing.has(slug));
    if (missing.length) throw new BadRequestException(`Unknown or unapproved ${kind} slug: ${missing.join(", ")}`);
  }

  private async withListingMetrics<T extends { id: string; _count?: { responses?: number; reports?: number } }>(input: T, viewerId?: string): Promise<T & { likes: number; responses: number; reports: number; likedByMe: boolean }>;
  private async withListingMetrics<T extends { id: string; _count?: { responses?: number; reports?: number } }>(input: T[], viewerId?: string): Promise<Array<T & { likes: number; responses: number; reports: number; likedByMe: boolean }>>;
  private async withListingMetrics<T extends { id: string; _count?: { responses?: number; reports?: number } }>(input: T | T[], viewerId?: string) {
    const items = Array.isArray(input) ? input : [input];
    const ids = items.map((item) => item.id);
    const [likeCounts, viewerLikes] = ids.length
      ? await Promise.all([
          this.prisma.like.groupBy({
            by: ["entityId"],
            where: { entityType: "LISTING", entityId: { in: ids } },
            _count: { _all: true }
          }),
          viewerId
            ? this.prisma.like.findMany({
                where: { userId: viewerId, entityType: "LISTING", entityId: { in: ids } },
                select: { entityId: true }
              })
            : []
        ])
      : [[], []];
    const likesById = new Map(likeCounts.map((item) => [item.entityId, item._count._all]));
    const likedByViewer = new Set(viewerLikes.map((item) => item.entityId));
    const mapped = items.map((item) => ({
      ...item,
      likes: likesById.get(item.id) || 0,
      likedByMe: likedByViewer.has(item.id),
      responses: item._count?.responses || 0,
      reports: item._count?.reports || 0
    }));
    return Array.isArray(input) ? mapped : mapped[0];
  }

  private catalogQuery(value: string) {
    return {
      OR: [
        { slug: { equals: value, mode: "insensitive" as const } },
        { name: { equals: value, mode: "insensitive" as const } }
      ]
    };
  }
}

function publicAuthorWhere(): Prisma.UserWhereInput {
  return { status: { notIn: ["BANNED", "TEMP_BANNED", "DELETED"] } };
}
