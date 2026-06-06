import { BadRequestException, Injectable } from "@nestjs/common";
import { CatalogStatus, SuggestionStatus } from "@prisma/client";
import { PageQueryDto } from "../../common/page-query.dto";
import { paged, pagination } from "../../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSuggestionDto } from "./dto";

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  tags() {
    return this.prisma.tag.findMany({
      where: { status: CatalogStatus.APPROVED },
      orderBy: { name: "asc" }
    });
  }

  genres() {
    return this.prisma.genre.findMany({
      where: { status: CatalogStatus.APPROVED },
      orderBy: { name: "asc" }
    });
  }

  fandoms() {
    return this.prisma.fandom.findMany({
      where: { status: CatalogStatus.APPROVED },
      orderBy: { name: "asc" }
    });
  }

  characters(fandomSlug?: string) {
    return this.prisma.character.findMany({
      where: {
        status: CatalogStatus.APPROVED,
        ...(fandomSlug ? { fandom: { slug: fandomSlug } } : {})
      },
      include: { fandom: true },
      orderBy: { name: "asc" }
    });
  }

  async suggest(authorId: string, dto: CreateSuggestionDto) {
    const existing = await this.prisma.moderationSuggestion.findFirst({
      where: {
        authorId,
        type: dto.type,
        title: { equals: dto.title, mode: "insensitive" },
        status: { in: [SuggestionStatus.NEW, SuggestionStatus.IN_REVIEW] }
      },
      select: { id: true }
    });
    if (existing) throw new BadRequestException("Active suggestion already exists");
    return this.prisma.moderationSuggestion.create({
      data: {
        authorId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        sourceUrl: dto.sourceUrl
      }
    });
  }

  async mySuggestions(authorId: string, query: PageQueryDto = {}) {
    if (query.page === undefined && query.pageSize === undefined) {
      return this.prisma.moderationSuggestion.findMany({
        where: { authorId },
        orderBy: { createdAt: "desc" }
      });
    }
    const page = pagination(query);
    const [total, hits] = await Promise.all([
      this.prisma.moderationSuggestion.count({ where: { authorId } }),
      this.prisma.moderationSuggestion.findMany({
        where: { authorId },
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.pageSize
      })
    ]);
    return paged(hits, total, page);
  }

}
