import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma, User, UserStatus } from "@prisma/client";
import { hash, verify as verifyHash } from "argon2";
import { createHash, randomBytes } from "crypto";
import { sign, verify } from "jsonwebtoken";
import { parsePublicWebOrigins } from "../../common/env";
import { sendTransactionalEmail } from "../../common/mail";
import { PrismaService } from "../prisma/prisma.service";
import { deleteUploadedImageByUrl, deleteUploadedImageIfReplaced } from "../uploads/upload-storage";
import {
  ChangePasswordDto,
  ConfirmPasswordResetDto,
  DeactivateAccountDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  RequestPasswordResetDto,
  UpdateProfileDto
} from "./dto";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const username = dto.username.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { profile: { username } }]
      }
    });
    if (existing) throw new ConflictException("Email or username is already used");

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hash(dto.password),
        profile: {
          create: {
            username,
            displayName: dto.displayName
          }
        },
        preferences: { create: {} }
      },
      include: { profile: true, preferences: true }
    });

    return this.session(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { profile: true, preferences: true }
    });
    if (!user || !(await verifyHash(user.passwordHash, dto.password))) {
      throw new UnauthorizedException("Invalid credentials");
    }
    const status = await this.ensureCanLogin(user.id, user.status);
    return this.session({ ...user, status });
  }

  async refresh(dto: RefreshTokenDto) {
    return this.refreshFromToken(dto.refreshToken);
  }

  async refreshFromDtoOrCookie(dto: Partial<RefreshTokenDto>, cookieHeader?: string) {
    return this.refreshFromToken(dto.refreshToken || this.cookieValue(cookieHeader, "cofind_session") || "");
  }

  async refreshFromToken(refreshToken: string) {
    let payload: { id?: string };
    try {
      payload = verify(refreshToken, process.env.JWT_REFRESH_SECRET || "dev-refresh-secret") as { id?: string };
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }
    if (!payload.id) throw new UnauthorizedException("Invalid refresh token");
    const user = await this.prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) throw new UnauthorizedException("User not found");
    const status = await this.ensureCanLogin(user.id, user.status);
    return this.session({ ...user, status });
  }

  async requireStaffFromCookie(cookieHeader?: string) {
    const sessionToken = this.cookieValue(cookieHeader, "cofind_session");
    if (!sessionToken) throw new UnauthorizedException("Session is required");
    let payload: { id?: string };
    try {
      payload = verify(sessionToken, process.env.JWT_REFRESH_SECRET || "dev-refresh-secret") as { id?: string };
    } catch {
      throw new UnauthorizedException("Invalid session");
    }
    if (!payload.id) throw new UnauthorizedException("Invalid session");
    const user = await this.prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, role: true, status: true }
    });
    if (!user) throw new UnauthorizedException("User not found");
    const status = await this.ensureCanLogin(user.id, user.status);
    if (!["OWNER", "ADMIN", "MODERATOR"].includes(user.role)) throw new ForbiddenException("Staff role is required");
  }

  setSessionCookies(response: { setHeader: (name: string, value: string | string[]) => void }, session: { accessToken: string; refreshToken: string }) {
    response.setHeader("Set-Cookie", [
      this.cookieHeader("cofind_access", session.accessToken, 15 * 60),
      this.cookieHeader("cofind_session", session.refreshToken, 30 * 24 * 60 * 60)
    ]);
  }

  clearSessionCookies(response: { setHeader: (name: string, value: string | string[]) => void }) {
    response.setHeader("Set-Cookie", [
      this.cookieHeader("cofind_access", "", 0),
      this.cookieHeader("cofind_session", "", 0)
    ]);
  }

  async requestPasswordReset(dto: RequestPasswordResetDto) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { ok: true };

    const token = randomBytes(32).toString("hex");
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: this.tokenHash(token),
        passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });
    await this.sendPasswordResetEmail(email, token);

    return {
      ok: true,
      ...(process.env.NODE_ENV === "production" ? {} : { resetToken: token })
    };
  }

  async confirmPasswordReset(dto: ConfirmPasswordResetDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetTokenHash: this.tokenHash(dto.token),
        passwordResetExpiresAt: { gt: new Date() }
      }
    });
    if (!user) throw new BadRequestException("Invalid or expired password reset token");

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hash(dto.newPassword),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null
      }
    });
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        isPremium: true,
        lastSeenAt: true,
        profile: true,
        preferences: true,
        subscription: { include: { plan: true } }
      }
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const { showLastSeen, allowProfileMessages, socialWebsite, socialTelegram, socialDiscord, ...rawProfileData } = dto;
    const profileData: Prisma.ProfileUpdateInput = { ...rawProfileData };
    if (dto.avatarUrl === "") profileData.avatarUrl = null;
    if (dto.coverImageUrl === "") profileData.coverImageUrl = null;
    let privacySettings: Prisma.InputJsonObject | undefined;
    let socialLinks: Prisma.InputJsonObject | undefined;
    const shouldUpdatePrivacy = showLastSeen !== undefined || allowProfileMessages !== undefined;
    const shouldUpdateSocials = socialWebsite !== undefined || socialTelegram !== undefined || socialDiscord !== undefined;
    const shouldCleanupImages = dto.avatarUrl !== undefined || dto.coverImageUrl !== undefined;
    const profile = shouldUpdatePrivacy || shouldUpdateSocials || shouldCleanupImages
      ? await this.prisma.profile.findUnique({
          where: { userId },
          select: { privacySettings: true, socialLinks: true, avatarUrl: true, coverImageUrl: true }
        })
      : null;
    if (shouldUpdatePrivacy || shouldUpdateSocials) {
      if (shouldUpdatePrivacy) {
        const current = profile?.privacySettings && typeof profile.privacySettings === "object" && !Array.isArray(profile.privacySettings)
          ? profile.privacySettings as Prisma.JsonObject
          : {};
        privacySettings = {
          ...current,
          ...(showLastSeen !== undefined ? { showLastSeen } : {}),
          ...(allowProfileMessages !== undefined ? { allowProfileMessages } : {})
        };
      }
      if (shouldUpdateSocials) {
        const current = profile?.socialLinks && typeof profile.socialLinks === "object" && !Array.isArray(profile.socialLinks)
          ? profile.socialLinks as Prisma.JsonObject
          : {};
        socialLinks = {
          ...current,
          ...(socialWebsite !== undefined ? { website: socialWebsite } : {}),
          ...(socialTelegram !== undefined ? { telegram: socialTelegram } : {}),
          ...(socialDiscord !== undefined ? { discord: socialDiscord } : {})
        };
      }
    }
    const updated = await this.prisma.profile.update({
      where: { userId },
      data: {
        ...profileData,
        ...(privacySettings ? { privacySettings } : {}),
        ...(socialLinks ? { socialLinks } : {})
      }
    });
    await Promise.all([
      dto.avatarUrl !== undefined ? deleteUploadedImageIfReplaced(profile?.avatarUrl, updated.avatarUrl) : Promise.resolve(false),
      dto.coverImageUrl !== undefined ? deleteUploadedImageIfReplaced(profile?.coverImageUrl, updated.coverImageUrl) : Promise.resolve(false)
    ]);
    return updated;
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    if (!(await verifyHash(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException("Invalid current password");
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hash(dto.newPassword),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null
      }
    });
    return { ok: true };
  }

  async deactivate(userId: string, dto: DeactivateAccountDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true, preferences: true } });
    if (!user) throw new NotFoundException("User not found");
    if (!(await verifyHash(user.passwordHash, dto.password))) {
      throw new UnauthorizedException("Invalid current password");
    }
    const drawings = await this.prisma.canvasDrawing.findMany({
      where: { userId },
      select: { imageUrl: true }
    });
    await this.prisma.$transaction([
      this.prisma.listing.updateMany({
        where: { authorId: userId, status: { not: "DELETED" } },
        data: { status: "DELETED" }
      }),
      this.prisma.canvasDrawing.deleteMany({
        where: { userId }
      }),
      this.prisma.userSubscription.updateMany({
        where: { userId, status: "ACTIVE" },
        data: { status: "CANCELED", canceledAt: new Date() }
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: UserStatus.DELETED,
          isPremium: false,
          passwordHash: await hash(randomBytes(32).toString("hex")),
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          profile: user.profile
            ? {
                update: {
                  displayName: "Deleted user",
                  avatarUrl: null,
                  coverImageUrl: null,
                  bio: null,
                  writingStyle: null,
                  literacyLevel: null,
                  preferredPostLength: null,
                  activityLevel: null,
                  favoriteGenres: [],
                  favoriteFandoms: [],
                  favoriteCharacters: [],
                  communicationPreferences: null,
                  privacySettings: {},
                  socialLinks: {}
                }
              }
            : undefined
        }
      })
    ]);
    await Promise.all([
      deleteUploadedImageIfReplaced(user.profile?.avatarUrl, null),
      deleteUploadedImageIfReplaced(user.profile?.coverImageUrl, null),
      deleteUploadedImageIfReplaced(user.preferences?.dashboardBackgroundImage, null),
      ...drawings.map((drawing) => deleteUploadedImageByUrl(drawing.imageUrl))
    ]);
    return { ok: true, status: UserStatus.DELETED };
  }

  private cookieValue(cookieHeader: string | undefined, name: string) {
    const cookies = String(cookieHeader || "").split(";").map((item) => item.trim()).filter(Boolean);
    const prefix = `${name}=`;
    const raw = cookies.find((item) => item.startsWith(prefix));
    if (!raw) return null;
    try {
      return decodeURIComponent(raw.slice(prefix.length));
    } catch {
      return raw.slice(prefix.length);
    }
  }

  private cookieHeader(name: string, value: string, maxAgeSeconds: number) {
    const secure = process.env.NODE_ENV === "production" ? "Secure" : "";
    return [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
      secure
    ].filter(Boolean).join("; ");
  }

  private session(user: Pick<User, "id" | "email" | "role" | "status" | "isPremium">) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status
    };
    return {
      accessToken: sign(payload, process.env.JWT_ACCESS_SECRET || "dev-access-secret", { expiresIn: "15m" }),
      refreshToken: sign(payload, process.env.JWT_REFRESH_SECRET || "dev-refresh-secret", { expiresIn: "30d" }),
      user: payload,
      isPremium: user.isPremium
    };
  }

  private async ensureCanLogin(userId: string, status: UserStatus) {
    if (status === UserStatus.DELETED || status === UserStatus.BANNED) throw new UnauthorizedException("User is blocked");
    const now = new Date();
    if (status === UserStatus.TEMP_BANNED) {
      await this.prisma.ban.updateMany({
        where: { userId, revokedAt: null, type: "TEMP_BAN", expiresAt: { lte: now } },
        data: { revokedAt: now }
      });
    }
    const activeBan = await this.prisma.ban.findFirst({
      where: {
        userId,
        revokedAt: null,
        type: { in: ["TEMP_BAN", "PERMANENT_BAN"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      }
    });
    if (activeBan) throw new UnauthorizedException("User is blocked");
    if (status === UserStatus.TEMP_BANNED) {
      await this.prisma.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
      return UserStatus.ACTIVE;
    }
    return status;
  }

  private tokenHash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async sendPasswordResetEmail(email: string, token: string) {
    const webOrigin = parsePublicWebOrigins(process.env.PUBLIC_WEB_URL)[0] || "http://localhost:3000";
    const resetUrl = `${webOrigin}/auth?resetToken=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    try {
      await sendTransactionalEmail({
        to: email,
        subject: "Восстановление пароля Cofind",
        text: [
          "Вы запросили восстановление пароля Cofind.",
          `Откройте ссылку и задайте новый пароль: ${resetUrl}`,
          "Если вы не запрашивали восстановление, просто проигнорируйте это письмо."
        ].join("\n\n"),
        html: [
          "<p>Вы запросили восстановление пароля Cofind.</p>",
          `<p><a href="${escapeHtml(resetUrl)}">Задать новый пароль</a></p>`,
          "<p>Если вы не запрашивали восстановление, просто проигнорируйте это письмо.</p>"
        ].join("")
      });
    } catch (error) {
      console.error("[mail] password reset email failed", error);
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
