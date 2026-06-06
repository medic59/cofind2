import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("Health")
@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  health() {
    return this.live();
  }

  @Get("live")
  live() {
    return {
      ok: true,
      service: "cofind-api",
      timestamp: new Date().toISOString()
    };
  }

  @Get("ready")
  async ready() {
    const [database, meilisearch] = await Promise.all([this.databaseStatus(), this.meilisearchStatus()]);
    return {
      ok: database.ok && meilisearch.ok,
      service: "cofind-api",
      dependencies: { database, meilisearch },
      timestamp: new Date().toISOString()
    };
  }

  private async databaseStatus() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Database check failed" };
    }
  }

  private async meilisearchStatus() {
    const host = process.env.MEILISEARCH_HOST || process.env.MEILI_HOST || "http://localhost:7700";
    try {
      const response = await fetch(`${host}/health`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Meilisearch check failed" };
    }
  }
}
