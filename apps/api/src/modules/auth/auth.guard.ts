import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserStatus } from "@prisma/client";
import { verify } from "jsonwebtoken";
import { PrismaService } from "../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { RequestUser } from "./current-user.decorator";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector = new Reflector(),
    private readonly prisma?: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined>; user?: RequestUser }>();
    const rawAuthorization = request.headers.authorization || request.headers.Authorization;
    const authorization = Array.isArray(rawAuthorization) ? rawAuthorization[0] : rawAuthorization;
    const token = authorization?.replace(/^Bearer\s+/i, "") || this.cookieValue(request.headers.cookie, "cofind_access");
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException("Bearer token is required");
    }

    try {
      const payload = verify(token, process.env.JWT_ACCESS_SECRET || "dev-access-secret") as RequestUser;
      const checkedUser = this.prisma ? await this.currentUserFromDatabase(payload.id) : payload;
      const blockedStatuses: UserStatus[] = [UserStatus.BANNED, UserStatus.DELETED];
      if (blockedStatuses.includes(checkedUser.status)) {
        throw new UnauthorizedException("User is blocked");
      }
      request.user = checkedUser;
      return true;
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException("Invalid or expired token");
    }
  }

  private cookieValue(cookieHeader: string | string[] | undefined, name: string) {
    const source = Array.isArray(cookieHeader) ? cookieHeader.join(";") : String(cookieHeader || "");
    const prefix = `${name}=`;
    const raw = source.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
    if (!raw) return null;
    try {
      return decodeURIComponent(raw.slice(prefix.length));
    } catch {
      return raw.slice(prefix.length);
    }
  }

  private async currentUserFromDatabase(userId: string): Promise<RequestUser> {
    const now = new Date();
    const user = await this.prisma?.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        lastSeenAt: true,
        bansReceived: {
          where: {
            revokedAt: null,
            type: { in: ["TEMP_BAN", "PERMANENT_BAN"] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
          },
          take: 1
        }
      }
    });
    if (!user) throw new UnauthorizedException("User not found");
    if (user.bansReceived.length) throw new UnauthorizedException("User is banned");
    let status = user.status;
    if (status === UserStatus.TEMP_BANNED) {
      await this.prisma?.ban.updateMany({
        where: { userId, revokedAt: null, type: "TEMP_BAN", expiresAt: { lte: now } },
        data: { revokedAt: now }
      });
      await this.prisma?.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
      status = UserStatus.ACTIVE;
    }
    if (!user.lastSeenAt || now.getTime() - user.lastSeenAt.getTime() > 5 * 60 * 1000) {
      await this.prisma?.user.update({ where: { id: userId }, data: { lastSeenAt: now } });
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status
    };
  }
}
