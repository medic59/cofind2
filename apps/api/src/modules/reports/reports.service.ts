import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ReportEntityType, ReportStatus } from "@prisma/client";
import { PageQueryDto } from "../../common/page-query.dto";
import { paged, pagination } from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReportDto } from "./dto";

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(reporterId: string, dto: CreateReportDto) {
    await this.ensureEntityExists(dto.entityType, dto.entityId);
    await this.ensureNotOwnMessageReport(reporterId, dto.entityType, dto.entityId);
    const duplicate = await this.prisma.report.findFirst({
      where: {
        reporterId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        status: { in: [ReportStatus.NEW, ReportStatus.IN_REVIEW] }
      },
      select: { id: true }
    });
    if (duplicate) throw new BadRequestException("Active report already exists");
    return this.prisma.report.create({
      data: {
        reporterId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        reason: dto.reason,
        comment: dto.comment,
        listingId: dto.entityType === ReportEntityType.LISTING ? dto.entityId : undefined
      }
    });
  }

  async my(reporterId: string, query: PageQueryDto = {}) {
    if (query.page === undefined && query.pageSize === undefined) {
      return this.prisma.report.findMany({
        where: { reporterId },
        orderBy: { createdAt: "desc" }
      });
    }
    const page = pagination(query);
    const [total, hits] = await Promise.all([
      this.prisma.report.count({ where: { reporterId } }),
      this.prisma.report.findMany({
        where: { reporterId },
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.pageSize
      })
    ]);
    return paged(hits, total, page);
  }

  private async ensureEntityExists(entityType: ReportEntityType, entityId: string) {
    const exists =
      entityType === ReportEntityType.LISTING
        ? await this.prisma.listing.findUnique({ where: { id: entityId }, select: { id: true } })
        : entityType === ReportEntityType.GLOBAL_CHAT_MESSAGE
          ? await this.prisma.globalChatMessage.findFirst({ where: { id: entityId, isDeleted: false }, select: { id: true } })
          : entityType === ReportEntityType.PRIVATE_MESSAGE
            ? await this.prisma.message.findFirst({ where: { id: entityId, isDeleted: false }, select: { id: true } })
            : entityType === ReportEntityType.PROFILE
              ? await this.prisma.user.findFirst({
                  where: { OR: [{ id: entityId }, { profile: { username: entityId } }] },
                  select: { id: true }
                })
              : entityType === ReportEntityType.TAG
                ? await this.prisma.tag.findFirst({ where: { OR: [{ id: entityId }, { slug: entityId }] }, select: { id: true } })
                : entityType === ReportEntityType.FANDOM
                  ? await this.prisma.fandom.findFirst({ where: { OR: [{ id: entityId }, { slug: entityId }] }, select: { id: true } })
                  : entityType === ReportEntityType.CHARACTER
                    ? await this.prisma.character.findFirst({ where: { OR: [{ id: entityId }, { slug: entityId }] }, select: { id: true } })
                    : null;
    if (!exists) throw new NotFoundException("Reported entity not found");
  }

  private async ensureNotOwnMessageReport(reporterId: string, entityType: ReportEntityType, entityId: string) {
    const owner =
      entityType === ReportEntityType.GLOBAL_CHAT_MESSAGE
        ? await this.prisma.globalChatMessage.findFirst({ where: { id: entityId, isDeleted: false }, select: { senderId: true } })
        : entityType === ReportEntityType.PRIVATE_MESSAGE
          ? await this.prisma.message.findFirst({ where: { id: entityId, isDeleted: false }, select: { senderId: true } })
          : null;
    if (owner?.senderId === reporterId) throw new BadRequestException("Cannot report your own message");
  }
}
