import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SearchListingSort, SearchListingsQueryDto } from "./dto";

const indexName = "cofind_listings";

type SearchDocument = {
  id: string;
  title: string;
  body: string;
  type: string;
  ageRating: string;
  tags: string[];
  tagSlugs: string[];
  tagTerms: string[];
  genres: string[];
  genreSlugs: string[];
  genreTerms: string[];
  fandoms: string[];
  fandomSlugs: string[];
  fandomTerms: string[];
  characters: string[];
  characterSlugs: string[];
  characterTerms: string[];
  likes: number;
  responses: number;
  reports: number;
  authorUsername?: string;
  authorDisplayName?: string;
  authorStatus?: string;
  publishedAt?: string;
};

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async listings(query: SearchListingsQueryDto, viewerId?: string) {
    if (query.sort && query.sort !== "new") {
      return this.searchPostgres(query, viewerId);
    }
    if (query.q || query.tag || query.genre || query.fandom || query.character) {
      const meili = await this.searchMeili(query).catch(() => null);
      if (meili) {
        const postgres = await this.searchPostgres(query, viewerId);
        return this.mergeMeiliWithPostgres(meili, postgres);
      }
    }
    return this.searchPostgres(query, viewerId);
  }

  async reindexListings() {
    const listings = await this.prisma.listing.findMany({
      where: { status: "PUBLISHED", moderationStatus: "APPROVED", author: publicAuthorWhere() },
      include: {
        author: { select: { profile: true, status: true } },
        tags: { include: { tag: true } },
        genres: { include: { genre: true } },
        fandoms: { include: { fandom: true } },
        characters: { include: { character: true } }
      }
    });
    const metrics = await this.listingMetrics(listings.map((listing) => listing.id));
    const documents: SearchDocument[] = listings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      body: listing.body,
      type: listing.type,
      ageRating: listing.ageRating,
      tags: listing.tags.map((item) => item.tag.name),
      tagSlugs: listing.tags.map((item) => item.tag.slug),
      tagTerms: this.catalogTerms(listing.tags.map((item) => [item.tag.name, item.tag.slug]).flat()),
      genres: listing.genres.map((item) => item.genre.name),
      genreSlugs: listing.genres.map((item) => item.genre.slug),
      genreTerms: this.catalogTerms(listing.genres.map((item) => [item.genre.name, item.genre.slug]).flat()),
      fandoms: listing.fandoms.map((item) => item.fandom.name),
      fandomSlugs: listing.fandoms.map((item) => item.fandom.slug),
      fandomTerms: this.catalogTerms(listing.fandoms.map((item) => [item.fandom.name, item.fandom.slug]).flat()),
      characters: listing.characters.map((item) => item.character.name),
      characterSlugs: listing.characters.map((item) => item.character.slug),
      characterTerms: this.catalogTerms(listing.characters.map((item) => [item.character.name, item.character.slug]).flat()),
      likes: metrics.likes.get(listing.id) || 0,
      responses: metrics.responses.get(listing.id) || 0,
      reports: metrics.reports.get(listing.id) || 0,
      authorUsername: listing.author.profile?.username,
      authorDisplayName: listing.author.profile?.displayName,
      authorStatus: listing.author.status,
      publishedAt: listing.publishedAt?.toISOString()
    }));

    const indexTask = await this.meiliFetch(`/indexes/${indexName}`).catch(async () => {
      return this.meiliFetch("/indexes", {
        method: "POST",
        body: JSON.stringify({ uid: indexName, primaryKey: "id" })
      });
    });
    await this.waitForTask(indexTask?.taskUid);
    const filterTask = await this.meiliFetch(`/indexes/${indexName}/settings/filterable-attributes`, {
      method: "PUT",
      body: JSON.stringify([
        "type",
        "ageRating",
        "tags",
        "tagSlugs",
        "tagTerms",
        "genres",
        "genreSlugs",
        "genreTerms",
        "fandoms",
        "fandomSlugs",
        "fandomTerms",
        "characters",
        "characterSlugs",
        "characterTerms",
        "authorStatus"
      ])
    });
    const sortTask = await this.meiliFetch(`/indexes/${indexName}/settings/sortable-attributes`, {
      method: "PUT",
      body: JSON.stringify(["publishedAt"])
    });
    await Promise.all([this.waitForTask(filterTask?.taskUid), this.waitForTask(sortTask?.taskUid)]);
    const deleteTask = await this.meiliFetch(`/indexes/${indexName}/documents`, {
      method: "DELETE"
    });
    await this.waitForTask(deleteTask?.taskUid);
    const task = documents.length
      ? await this.meiliFetch(`/indexes/${indexName}/documents`, {
          method: "POST",
          body: JSON.stringify(documents)
        })
      : null;
    await this.waitForTask(task?.taskUid);
    return { indexed: documents.length, task, deleteTask };
  }

  private async searchMeili(query: SearchListingsQueryDto) {
    const pagination = this.pagination(query);
    const filter = [
      query.type ? `type = ${JSON.stringify(query.type)}` : null,
      query.ageRating ? `ageRating = ${JSON.stringify(query.ageRating)}` : null,
      query.tag ? this.catalogFilter("tagTerms", query.tag) : null,
      query.genre ? this.catalogFilter("genreTerms", query.genre) : null,
      query.fandom ? this.catalogFilter("fandomTerms", query.fandom) : null,
      query.character ? this.catalogFilter("characterTerms", query.character) : null,
      'authorStatus != "BANNED"',
      'authorStatus != "TEMP_BANNED"',
      'authorStatus != "DELETED"'
    ].filter(Boolean);
    const result = await this.meiliFetch(`/indexes/${indexName}/search`, {
      method: "POST",
      body: JSON.stringify({
        q: query.q || "",
        filter,
        sort: ["publishedAt:desc"],
        limit: pagination.pageSize,
        offset: pagination.skip
      })
    });
    return {
      source: "meilisearch",
      hits: result.hits || [],
      estimatedTotalHits: result.estimatedTotalHits || 0,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: result.estimatedTotalHits || 0,
        totalPages: Math.max(1, Math.ceil((result.estimatedTotalHits || 0) / pagination.pageSize))
      }
    };
  }

  private async searchPostgres(query: SearchListingsQueryDto, viewerId?: string) {
    const pagination = this.pagination(query);
    const where: Prisma.ListingWhereInput = {
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
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
        { tags: { some: { tag: { name: { contains: query.q, mode: "insensitive" } } } } },
        { genres: { some: { genre: { name: { contains: query.q, mode: "insensitive" } } } } },
        { fandoms: { some: { fandom: { name: { contains: query.q, mode: "insensitive" } } } } },
        { characters: { some: { character: { name: { contains: query.q, mode: "insensitive" } } } } }
      ];
    }
    if (query.sort && query.sort !== "new") {
      return this.searchPostgresSorted(where, pagination, query.sort, viewerId);
    }
    const [total, listings] = await Promise.all([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        include: {
          author: { select: { id: true, profile: true, role: true, status: true, isPremium: true } },
          tags: { include: { tag: true } },
          genres: { include: { genre: true } },
          fandoms: { include: { fandom: true } },
          characters: { include: { character: true } },
          _count: { select: { responses: true, reports: true } }
        },
        orderBy: { publishedAt: "desc" },
        skip: pagination.skip,
        take: pagination.pageSize
      })
    ]);
    const metrics = await this.listingMetrics(listings.map((listing) => listing.id), viewerId);
    const hits = listings.map((listing) => ({
      ...listing,
      likes: metrics.likes.get(listing.id) || 0,
      likedByMe: metrics.likedByMe.has(listing.id),
      responses: metrics.responses.get(listing.id) || 0,
      reports: metrics.reports.get(listing.id) || 0
    }));
    return {
      source: "postgres",
      hits,
      estimatedTotalHits: total,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize))
      }
    };
  }

  private async searchPostgresSorted(
    where: Prisma.ListingWhereInput,
    pagination: { page: number; pageSize: number; skip: number },
    sort: Exclude<SearchListingSort, "new">,
    viewerId?: string
  ) {
    const candidates = await this.prisma.listing.findMany({
      where,
      select: {
        id: true,
        publishedAt: true,
        _count: { select: { responses: true, reports: true } }
      }
    });
    const metrics = await this.listingMetrics(candidates.map((listing) => listing.id), viewerId);
    const publishedTime = (value: Date | null) => value?.getTime() || 0;
    const sorted = candidates.sort((a, b) => {
      if (sort === "popular") {
        const likesDiff = (metrics.likes.get(b.id) || 0) - (metrics.likes.get(a.id) || 0);
        if (likesDiff) return likesDiff;
        return publishedTime(b.publishedAt) - publishedTime(a.publishedAt);
      }
      const responseDiff = (metrics.responses.get(a.id) || a._count.responses || 0) - (metrics.responses.get(b.id) || b._count.responses || 0);
      if (responseDiff) return responseDiff;
      return publishedTime(b.publishedAt) - publishedTime(a.publishedAt);
    });
    const pageIds = sorted.slice(pagination.skip, pagination.skip + pagination.pageSize).map((listing) => listing.id);
    const listings = pageIds.length
      ? await this.prisma.listing.findMany({
          where: { id: { in: pageIds } },
          include: {
            author: { select: { id: true, profile: true, role: true, status: true, isPremium: true } },
            tags: { include: { tag: true } },
            genres: { include: { genre: true } },
            fandoms: { include: { fandom: true } },
            characters: { include: { character: true } },
            _count: { select: { responses: true, reports: true } }
          }
        })
      : [];
    const order = new Map(pageIds.map((id, index) => [id, index]));
    const hits = listings
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((listing) => ({
        ...listing,
        likes: metrics.likes.get(listing.id) || 0,
        likedByMe: metrics.likedByMe.has(listing.id),
        responses: metrics.responses.get(listing.id) || 0,
        reports: metrics.reports.get(listing.id) || 0
      }));
    return {
      source: "postgres",
      hits,
      estimatedTotalHits: candidates.length,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: candidates.length,
        totalPages: Math.max(1, Math.ceil(candidates.length / pagination.pageSize))
      }
    };
  }

  private async listingMetrics(ids: string[], viewerId?: string) {
    if (!ids.length) {
      return { likes: new Map<string, number>(), likedByMe: new Set<string>(), responses: new Map<string, number>(), reports: new Map<string, number>() };
    }
    const [likes, viewerLikes, responses, reports] = await Promise.all([
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
        : [],
      this.prisma.listingResponse.groupBy({
        by: ["listingId"],
        where: { listingId: { in: ids } },
        _count: { _all: true }
      }),
      this.prisma.report.groupBy({
        by: ["listingId"],
        where: { listingId: { in: ids } },
        _count: { _all: true }
      })
    ]);
    return {
      likes: new Map(likes.map((item) => [item.entityId, item._count._all])),
      likedByMe: new Set(viewerLikes.map((item) => item.entityId)),
      responses: new Map(responses.map((item) => [item.listingId, item._count._all])),
      reports: new Map(reports.map((item) => [item.listingId || "", item._count._all]))
    };
  }

  private mergeMeiliWithPostgres<T extends { id: string; likes?: number; likedByMe?: boolean; responses?: number; reports?: number }>(
    meili: { source: string; hits: SearchDocument[]; estimatedTotalHits: number; pagination?: unknown },
    postgres: { source: string; hits: T[]; estimatedTotalHits: number; pagination?: unknown }
  ) {
    const freshById = new Map(postgres.hits.map((hit) => [hit.id, hit]));
    const ordered = meili.hits
      .map((hit) => {
        const fresh = freshById.get(hit.id);
        return fresh
          ? {
              ...hit,
              likes: fresh.likes || 0,
              likedByMe: Boolean(fresh.likedByMe),
              responses: fresh.responses || 0,
              reports: fresh.reports || 0
            }
          : null;
      })
      .filter((hit): hit is SearchDocument & { likedByMe: boolean } => Boolean(hit));
    const orderedIds = ordered.map((hit) => hit.id);
    const seen = new Set(orderedIds);
    const missingFresh = postgres.hits.filter((hit) => !seen.has(hit.id)).map((hit) => this.searchHitFromPostgres(hit));
    const hits = [...ordered, ...missingFresh];
    return {
      source: meili.source,
      hits,
      estimatedTotalHits: postgres.estimatedTotalHits,
      pagination: postgres.pagination
    };
  }

  private pagination(query: SearchListingsQueryDto) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 12)));
    return {
      page,
      pageSize,
      skip: (page - 1) * pageSize
    };
  }

  private searchHitFromPostgres(hit: Record<string, any>) {
    return {
      ...hit,
      tags: hit.tags?.map?.((item: any) => item.tag?.name).filter(Boolean) || [],
      tagSlugs: hit.tags?.map?.((item: any) => item.tag?.slug).filter(Boolean) || [],
      genres: hit.genres?.map?.((item: any) => item.genre?.name).filter(Boolean) || [],
      genreSlugs: hit.genres?.map?.((item: any) => item.genre?.slug).filter(Boolean) || [],
      fandoms: hit.fandoms?.map?.((item: any) => item.fandom?.name).filter(Boolean) || [],
      fandomSlugs: hit.fandoms?.map?.((item: any) => item.fandom?.slug).filter(Boolean) || [],
      characters: hit.characters?.map?.((item: any) => item.character?.name).filter(Boolean) || [],
      characterSlugs: hit.characters?.map?.((item: any) => item.character?.slug).filter(Boolean) || []
    };
  }

  private catalogFilter(termsField: string, value: string) {
    return `${termsField} = ${JSON.stringify(value.toLowerCase())}`;
  }

  private catalogTerms(values: string[]) {
    return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  }

  private catalogQuery(value: string) {
    return {
      OR: [
        { slug: { equals: value, mode: "insensitive" as const } },
        { name: { equals: value, mode: "insensitive" as const } }
      ]
    };
  }

  private async meiliFetch(path: string, init: RequestInit = {}) {
    const host = process.env.MEILISEARCH_HOST || process.env.MEILI_HOST || "http://localhost:7700";
    const key = process.env.MEILISEARCH_MASTER_KEY || process.env.MEILI_MASTER_KEY || "cofind_dev_master_key";
    const response = await fetch(`${host}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...init.headers
      }
    });
    if (!response.ok) {
      throw new Error(`Meilisearch ${path} failed: ${response.status}`);
    }
    return response.json();
  }

  private async waitForTask(taskUid?: number) {
    if (taskUid === undefined || taskUid === null) return null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const task = await this.meiliFetch(`/tasks/${taskUid}`);
      if (task.status === "succeeded") return task;
      if (task.status === "failed" || task.status === "canceled") {
        throw new Error(`Meilisearch task ${taskUid} ${task.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Meilisearch task ${taskUid} did not finish in time`);
  }
}

function publicAuthorWhere(): Prisma.UserWhereInput {
  return { status: { notIn: ["BANNED", "TEMP_BANNED", "DELETED"] } };
}
