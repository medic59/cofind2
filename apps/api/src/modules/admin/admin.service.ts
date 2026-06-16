import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ReportStatus, SuggestionStatus, UserRole, UserStatus } from "@prisma/client";
import { publicFeatureFlags, setAiEnabled, setMonetizationEnabled } from "../../common/system-settings";
import { getAiConfigView, updateAiConfig as applyAiConfig } from "../ai/ai-config";
import { PrismaService } from "../prisma/prisma.service";
import {
  ModerateListingDto,
  ModerateSuggestionDto,
  BanUserDto,
  ResolveReportDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
  UpsertAdPlacementDto,
  UpsertCatalogItemDto,
  UpsertSeoPageDto,
  UpsertSubscriptionPlanDto,
  UpdateAdminSettingsDto,
  UpdateAiConfigDto
} from "./dto";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const [users, listings, reports, suggestions, activeAds, premiumUsers, settings] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.listing.count(),
      this.prisma.report.count({ where: { status: { in: [ReportStatus.NEW, ReportStatus.IN_REVIEW] } } }),
      this.prisma.moderationSuggestion.count({ where: { status: { in: [SuggestionStatus.NEW, SuggestionStatus.IN_REVIEW] } } }),
      this.prisma.adPlacement.count({ where: { status: "ACTIVE" } }),
      this.prisma.user.count({ where: { isPremium: true } }),
      publicFeatureFlags(this.prisma)
    ]);
    return { users, listings, reports, suggestions, activeAds, premiumUsers, settings };
  }

  settings() {
    return publicFeatureFlags(this.prisma);
  }

  updateSettings(actorId: string, dto: UpdateAdminSettingsDto) {
    return this.prisma.$transaction(async (tx) => {
      const changes: Record<string, boolean> = {};
      if (dto.monetizationEnabled !== undefined) {
        await setMonetizationEnabled(tx, dto.monetizationEnabled);
        changes.monetizationEnabled = dto.monetizationEnabled;
      }
      if (dto.aiEnabled !== undefined) {
        await setAiEnabled(tx, dto.aiEnabled);
        changes.aiEnabled = dto.aiEnabled;
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: "UPDATE_SYSTEM_SETTINGS",
          entityType: "SYSTEM_SETTING",
          entityId: "features",
          metadata: changes
        }
      });
      return publicFeatureFlags(tx);
    });
  }

  aiConfig() {
    return getAiConfigView(this.prisma);
  }

  updateAiConfig(actorId: string, dto: UpdateAiConfigDto) {
    return this.prisma.$transaction(async (tx) => {
      const result = await applyAiConfig(tx, dto);
      await tx.auditLog.create({
        data: {
          actorId,
          action: "UPDATE_AI_CONFIG",
          entityType: "SYSTEM_SETTING",
          entityId: "ai.providers",
          // Never log the keys themselves — only which provider is default.
          metadata: { defaultProvider: result.defaultProvider }
        }
      });
      return result;
    });
  }

  users() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        isPremium: true,
        lastSeenAt: true,
        createdAt: true,
        profile: true
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  updateUserStatus(actorId: string, userId: string, dto: UpdateUserStatusDto) {
    if (actorId === userId) throw new BadRequestException("You cannot change your own status");
    return this.prisma.$transaction(async (tx) => {
      const { target } = await this.ensureCanManageUser(tx, actorId, userId);
      if (target.role === UserRole.OWNER && dto.status !== UserStatus.ACTIVE) {
        await this.ensureNotLastOwner(tx, userId);
      }
      const user = await tx.user.update({ where: { id: userId }, data: { status: dto.status } });
      await tx.auditLog.create({
        data: { actorId, action: "UPDATE_USER_STATUS", entityType: "USER", entityId: userId, metadata: { ...dto } }
      });
      return user;
    });
  }

  updateUserRole(actorId: string, userId: string, dto: UpdateUserRoleDto) {
    if (actorId === userId) throw new BadRequestException("You cannot change your own role");
    return this.prisma.$transaction(async (tx) => {
      const { actor, target } = await this.ensureCanManageUser(tx, actorId, userId);
      if (dto.role === UserRole.OWNER && actor.role !== UserRole.OWNER) {
        throw new ForbiddenException("Only owner can assign owner role");
      }
      if (actor.role !== UserRole.OWNER && roleRank(dto.role) >= roleRank(actor.role)) {
        throw new ForbiddenException("You cannot assign an equal or higher role");
      }
      if (target.role === UserRole.OWNER && dto.role !== UserRole.OWNER) await this.ensureNotLastOwner(tx, userId);
      const user = await tx.user.update({
        where: { id: userId },
        data: { role: dto.role, ...(dto.role === "PREMIUM_USER" ? { isPremium: true } : {}) }
      });
      await tx.auditLog.create({
        data: { actorId, action: "UPDATE_USER_ROLE", entityType: "USER", entityId: userId, metadata: { ...dto } }
      });
      return user;
    });
  }

  banUser(actorId: string, userId: string, dto: BanUserDto) {
    if (actorId === userId) throw new BadRequestException("You cannot ban yourself");
    const status = dto.type === "MUTE" ? "MUTED" : dto.type === "TEMP_BAN" ? "TEMP_BANNED" : "BANNED";
    return this.prisma.$transaction(async (tx) => {
      const { target } = await this.ensureCanManageUser(tx, actorId, userId);
      if (target.role === UserRole.OWNER) await this.ensureNotLastOwner(tx, userId);
      const ban = await tx.ban.create({
        data: {
          userId,
          issuedById: actorId,
          type: dto.type,
          reason: dto.reason,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined
        }
      });
      await tx.user.update({ where: { id: userId }, data: { status } });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "BAN_USER",
          entityType: "USER",
          entityId: userId,
          metadata: { type: dto.type, expiresAt: dto.expiresAt }
        }
      });
      return ban;
    });
  }

  unbanUser(actorId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { target } = await this.ensureCanManageUser(tx, actorId, userId);
      await tx.ban.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actorId }
      });
      const user = await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
      await tx.auditLog.create({
        data: {
          actorId,
          action: target.status === "DELETED" ? "RESTORE_USER" : "UNBAN_USER",
          entityType: "USER",
          entityId: userId,
          metadata: { previousStatus: target.status }
        }
      });
      return user;
    });
  }

  listings() {
    return this.prisma.listing.findMany({
      include: { author: { select: { profile: true, role: true } }, _count: { select: { reports: true, responses: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  moderateListing(actorId: string, listingId: string, dto: ModerateListingDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.listing.findUnique({
        where: { id: listingId },
        select: { id: true, status: true, moderationStatus: true }
      });
      if (!existing) throw new NotFoundException("Listing not found");
      const statusChanged = Boolean(
        (dto.status && dto.status !== existing.status) ||
          (dto.moderationStatus && dto.moderationStatus !== existing.moderationStatus)
      );
      const listing = await tx.listing.update({ where: { id: listingId }, data: dto });
      await tx.moderationAction.create({
        data: {
          actorId,
          action: dto.moderationStatus === "APPROVED" ? "APPROVE" : "UPDATE",
          entityType: "LISTING",
          entityId: listingId,
          metadata: { ...dto }
        }
      });
      await tx.auditLog.create({
        data: { actorId, action: "MODERATE_LISTING", entityType: "LISTING", entityId: listingId, metadata: { ...dto } }
      });
      if (statusChanged) {
        await tx.notification.create({
          data: {
            userId: listing.authorId,
            type: "SYSTEM",
            title: "Статус заявки обновлен",
            description: `Заявка "${listing.title}" получила статус ${dto.moderationStatus || dto.status}.`,
            linkPath: "/me"
          }
        });
      }
      return listing;
    });
  }

  reports() {
    return this.prisma.report.findMany({
      include: { reporter: { select: { profile: true, role: true } }, moderator: { select: { profile: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  resolveReport(actorId: string, reportId: string, dto: ResolveReportDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.report.findUnique({ where: { id: reportId }, select: { id: true, status: true } });
      if (!existing) throw new NotFoundException("Report not found");
      const statusChanged = dto.status !== existing.status;
      const report = await tx.report.update({
        where: { id: reportId },
        data: { status: dto.status, resolutionComment: dto.resolutionComment, moderatorId: actorId }
      });
      await tx.auditLog.create({
        data: { actorId, action: "RESOLVE_REPORT", entityType: "REPORT", entityId: reportId, metadata: { ...dto } }
      });
      if (statusChanged) {
        await tx.notification.create({
          data: {
            userId: report.reporterId,
            type: "REPORT_UPDATED",
            title: "Жалоба обновлена",
            description: `Статус жалобы: ${dto.status}.`,
            linkPath: "/reports/new"
          }
        });
      }
      return report;
    });
  }

  suggestions() {
    return this.prisma.moderationSuggestion.findMany({
      include: { author: { select: { profile: true } }, reviewedBy: { select: { profile: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  moderateSuggestion(actorId: string, suggestionId: string, dto: ModerateSuggestionDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.moderationSuggestion.findUnique({ where: { id: suggestionId }, select: { id: true, status: true } });
      if (!existing) throw new NotFoundException("Suggestion not found");
      const statusChanged = dto.status !== existing.status;
      const suggestion = await tx.moderationSuggestion.update({
        where: { id: suggestionId },
        data: { status: dto.status, moderatorComment: dto.moderatorComment, reviewedById: actorId }
      });
      await tx.auditLog.create({
        data: { actorId, action: "MODERATE_SUGGESTION", entityType: "SUGGESTION", entityId: suggestionId, metadata: { ...dto } }
      });
      if (statusChanged) {
        await tx.notification.create({
          data: {
            userId: suggestion.authorId,
            type: "SUGGESTION_UPDATED",
            title: "Предложение обновлено",
            description: `Статус предложения "${suggestion.title}": ${dto.status}.`,
            linkPath: "/suggestions"
          }
        });
      }
      return suggestion;
    });
  }

  tags() {
    return this.prisma.tag.findMany({ orderBy: { name: "asc" } });
  }

  async upsertTag(actorId: string, dto: UpsertCatalogItemDto) {
    dto = { ...dto, slug: this.normalizeSlug(dto.slug) };
    this.assertSlug(dto.slug, "tag slug");
    await this.ensureCatalogNameAvailable("tag", dto.slug, dto.name);
    return this.prisma.$transaction(async (tx) => {
      const tag = await tx.tag.upsert({
        where: { slug: dto.slug },
        create: { slug: dto.slug, name: dto.name, description: dto.description, status: dto.status || "APPROVED" },
        update: { name: dto.name, description: dto.description, status: dto.status }
      });
      await tx.auditLog.create({ data: { actorId, action: "UPSERT_TAG", entityType: "TAG", entityId: tag.id, metadata: { slug: tag.slug } } });
      return tag;
    });
  }

  genres() {
    return this.prisma.genre.findMany({ orderBy: { name: "asc" } });
  }

  async upsertGenre(actorId: string, dto: UpsertCatalogItemDto) {
    dto = { ...dto, slug: this.normalizeSlug(dto.slug) };
    this.assertSlug(dto.slug, "genre slug");
    await this.ensureCatalogNameAvailable("genre", dto.slug, dto.name);
    return this.prisma.$transaction(async (tx) => {
      const genre = await tx.genre.upsert({
        where: { slug: dto.slug },
        create: { slug: dto.slug, name: dto.name, description: dto.description, status: dto.status || "APPROVED" },
        update: { name: dto.name, description: dto.description, status: dto.status }
      });
      await tx.auditLog.create({ data: { actorId, action: "UPSERT_GENRE", entityType: "GENRE", entityId: genre.id, metadata: { slug: genre.slug } } });
      return genre;
    });
  }

  fandoms() {
    return this.prisma.fandom.findMany({ orderBy: { name: "asc" } });
  }

  async upsertFandom(actorId: string, dto: UpsertCatalogItemDto) {
    dto = { ...dto, slug: this.normalizeSlug(dto.slug) };
    this.assertSlug(dto.slug, "fandom slug");
    await this.ensureCatalogNameAvailable("fandom", dto.slug, dto.name);
    return this.prisma.$transaction(async (tx) => {
      const fandom = await tx.fandom.upsert({
        where: { slug: dto.slug },
        create: { slug: dto.slug, name: dto.name, description: dto.description, status: dto.status || "APPROVED" },
        update: { name: dto.name, description: dto.description, status: dto.status }
      });
      await tx.auditLog.create({ data: { actorId, action: "UPSERT_FANDOM", entityType: "FANDOM", entityId: fandom.id, metadata: { slug: fandom.slug } } });
      return fandom;
    });
  }

  characters() {
    return this.prisma.character.findMany({ include: { fandom: true }, orderBy: { name: "asc" } });
  }

  async upsertCharacter(actorId: string, dto: UpsertCatalogItemDto) {
    dto = { ...dto, slug: this.normalizeSlug(dto.slug) };
    this.assertSlug(dto.slug, "character slug");
    if (dto.fandomId) {
      const fandom = await this.prisma.fandom.findUnique({ where: { id: dto.fandomId }, select: { id: true } });
      if (!fandom) throw new NotFoundException("Fandom not found");
    }
    return this.prisma.$transaction(async (tx) => {
      const character = await tx.character.upsert({
        where: { slug: dto.slug },
        create: {
          slug: dto.slug,
          name: dto.name,
          description: dto.description,
          status: dto.status || "APPROVED",
          fandomId: dto.fandomId
        },
        update: { name: dto.name, description: dto.description, status: dto.status, fandomId: dto.fandomId }
      });
      await tx.auditLog.create({
        data: { actorId, action: "UPSERT_CHARACTER", entityType: "CHARACTER", entityId: character.id, metadata: { slug: character.slug } }
      });
      return character;
    });
  }

  ads() {
    return this.prisma.adPlacement.findMany({ orderBy: { createdAt: "desc" } });
  }

  async upsertAd(actorId: string, dto: UpsertAdPlacementDto, id?: string) {
    this.assertAdSchedule(dto);
    return this.prisma.$transaction(async (tx) => {
      let currentTarget: Prisma.JsonValue | undefined;
      if (id) {
        const existing = await tx.adPlacement.findUnique({ where: { id }, select: { id: true, target: true } });
        if (!existing) throw new NotFoundException("Ad placement not found");
        currentTarget = existing.target;
      }
      const data = this.adPlacementData(dto, currentTarget);
      const ad = id
        ? await tx.adPlacement.update({ where: { id }, data })
        : await tx.adPlacement.create({ data: { ...data, status: dto.status || "DRAFT" } });
      await tx.auditLog.create({ data: { actorId, action: "UPSERT_AD", entityType: "AD_PLACEMENT", entityId: ad.id, metadata: { position: ad.position } } });
      return ad;
    });
  }

  subscriptions() {
    return this.prisma.userSubscription.findMany({
      include: { user: { select: { email: true, profile: true } }, plan: true },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  payments() {
    return this.prisma.payment.findMany({
      include: { user: { select: { email: true, profile: true } }, plan: true },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  plans() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: { priceCents: "asc" } });
  }

  upsertPlan(actorId: string, dto: UpsertSubscriptionPlanDto) {
    dto = { ...dto, code: this.normalizeSlug(dto.code) };
    this.assertSlug(dto.code, "subscription plan code");
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.upsert({
        where: { code: dto.code },
        create: {
          code: dto.code,
          name: dto.name,
          description: dto.description,
          priceCents: dto.priceCents,
          currency: dto.currency || "RUB",
          durationDays: dto.durationDays,
          isActive: dto.isActive ?? true
        },
        update: {
          name: dto.name,
          description: dto.description,
          priceCents: dto.priceCents,
          currency: dto.currency,
          durationDays: dto.durationDays,
          isActive: dto.isActive
        }
      });
      await tx.auditLog.create({
        data: { actorId, action: "UPSERT_SUBSCRIPTION_PLAN", entityType: "SUBSCRIPTION_PLAN", entityId: plan.id, metadata: { code: plan.code } }
      });
      return plan;
    });
  }

  seoPages() {
    return this.prisma.seoPage.findMany({ orderBy: { path: "asc" } });
  }

  upsertSeoPage(actorId: string, dto: UpsertSeoPageDto) {
    dto = { ...dto, path: normalizePath(dto.path) };
    const data = {
      title: dto.title,
      description: dto.description,
      h1: dto.h1,
      canonical: dto.canonical || null,
      ogTitle: dto.ogTitle || null,
      ogDescription: dto.ogDescription || null,
      ogImage: dto.ogImage || null,
      indexable: dto.indexable ?? true,
      seoText: dto.seoText || null
    };
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.seoPage.upsert({
        where: { path: dto.path },
        create: { path: dto.path, ...data },
        update: data
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "UPSERT_SEO_PAGE",
          entityType: "SEO_PAGE",
          entityId: page.id,
          metadata: { path: page.path }
        }
      });
      return page;
    });
  }

  auditLog() {
    return this.prisma.auditLog.findMany({
      include: { actor: { select: { profile: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  private async ensureCatalogNameAvailable(kind: "tag" | "genre" | "fandom", slug: string, name: string) {
    const existing =
      kind === "tag"
        ? await this.prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" }, slug: { not: slug } }, select: { id: true } })
        : kind === "genre"
          ? await this.prisma.genre.findFirst({ where: { name: { equals: name, mode: "insensitive" }, slug: { not: slug } }, select: { id: true } })
          : await this.prisma.fandom.findFirst({ where: { name: { equals: name, mode: "insensitive" }, slug: { not: slug } }, select: { id: true } });
    if (existing) throw new BadRequestException(`${kind} name is already used`);
  }

  private normalizeSlug(value: string) {
    return value.trim().toLowerCase();
  }

  private assertSlug(value: string, label: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(value)) {
      throw new BadRequestException(`Invalid ${label}`);
    }
  }

  private assertAdSchedule(dto: UpsertAdPlacementDto) {
    if (!dto.startsAt || !dto.endsAt) return;
    if (new Date(dto.startsAt).getTime() > new Date(dto.endsAt).getTime()) {
      throw new BadRequestException("Ad start date cannot be after end date");
    }
  }

  private adPlacementData(dto: UpsertAdPlacementDto, currentTarget?: Prisma.JsonValue) {
    const { hideForPremium, ...data } = dto;
    if (hideForPremium === undefined) return data;
    const target = currentTarget && typeof currentTarget === "object" && !Array.isArray(currentTarget) ? currentTarget : {};
    return { ...data, target: { ...target, hideForPremium } };
  }

  private async ensureCanManageUser(tx: Prisma.TransactionClient, actorId: string, targetId: string) {
    const [actor, target] = await Promise.all([
      tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true } }),
      tx.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, status: true } })
    ]);
    if (!actor) throw new NotFoundException("Actor not found");
    if (!target) throw new NotFoundException("User not found");
    if (actor.role !== UserRole.OWNER && roleRank(actor.role) <= roleRank(target.role)) {
      throw new ForbiddenException("You cannot manage a user with equal or higher role");
    }
    return { actor, target };
  }

  private async ensureNotLastOwner(tx: Prisma.TransactionClient, ownerId: string) {
    const activeOwners = await tx.user.count({
      where: {
        id: { not: ownerId },
        role: UserRole.OWNER,
        status: { notIn: [UserStatus.BANNED, UserStatus.DELETED, UserStatus.TEMP_BANNED] }
      }
    });
    if (activeOwners < 1) throw new BadRequestException("The last owner cannot be disabled or demoted");
  }
}

function roleRank(role: UserRole) {
  return {
    [UserRole.USER]: 0,
    [UserRole.PREMIUM_USER]: 0,
    [UserRole.MODERATOR]: 1,
    [UserRole.ADMIN]: 2,
    [UserRole.OWNER]: 3
  }[role];
}

function normalizePath(value: string) {
  const path = value.trim() || "/";
  return path.startsWith("/") ? path : `/${path}`;
}
