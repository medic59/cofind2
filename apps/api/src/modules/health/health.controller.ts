import { Controller, Get, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { ChatRealtimeService } from "../chat/chat-realtime.service";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("Health")
@Public()
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: ChatRealtimeService
  ) {}

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

  // Readiness probe: 200 when DB, Meilisearch and the chat realtime component are
  // all healthy, HTTP 503 otherwise so load balancers / uptime monitors detect
  // it by status code (not just the body flag).
  @Get("ready")
  async ready(@Res({ passthrough: true }) res: any) {
    const [database, meilisearch] = await Promise.all([this.databaseStatus(), this.meilisearchStatus()]);
    const realtime = this.realtime.status();
    const ok = database.ok && meilisearch.ok && realtime.ok;
    res.status(ok ? 200 : 503);
    return {
      ok,
      service: "cofind-api",
      dependencies: { database, meilisearch, realtime },
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
