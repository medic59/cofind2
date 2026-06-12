import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { parsePublicWebOrigins } from "../../common/env";
import { sendTransactionalEmail } from "../../common/mail";
import { messageDigestEmail, responseDigestEmail } from "../../common/mail-templates";
import { PrismaService } from "../prisma/prisma.service";

export type DigestType = "RESPONSE" | "MESSAGE";

const HOUR_MS = 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // drain accumulated digests every 5 min

// Sends grouped notification emails: at most one email per hour per type, with
// intervening events batched into a single digest. The first event in a window
// sends immediately; later ones accumulate and go out on the next flush/event
// after the hour. All operations are best-effort and never break the caller.
@Injectable()
export class NotificationEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEmailService.name);
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.flushTimer = setInterval(() => {
      this.flushPending().catch((error) => this.logger.warn(`digest flush failed: ${error?.message || error}`));
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
  }

  queueResponse(recipientUserId: string) {
    return this.queue(recipientUserId, "RESPONSE");
  }

  queueMessage(recipientUserId: string) {
    return this.queue(recipientUserId, "MESSAGE");
  }

  // Record an event for the recipient and possibly send (if past the hour window).
  async queue(userId: string, type: DigestType) {
    try {
      if (!(await this.recipientWantsEmail(userId, type))) return;
      await this.prisma.emailDigest.upsert({
        where: { userId_type: { userId, type } },
        create: { userId, type, pendingCount: 1, firstPendingAt: new Date() },
        update: { pendingCount: { increment: 1 } }
      });
      // Set firstPendingAt for a fresh batch (cleared after each send).
      await this.prisma.emailDigest.updateMany({
        where: { userId, type, firstPendingAt: null, pendingCount: { gt: 0 } },
        data: { firstPendingAt: new Date() }
      });
      await this.maybeSend(userId, type);
    } catch (error) {
      this.logger.warn(`queue ${type} for ${userId} failed: ${(error as Error)?.message || error}`);
    }
  }

  // Periodic drain so batches accumulated during the hour go out without a new event.
  async flushPending() {
    const eligibleBefore = new Date(Date.now() - HOUR_MS);
    const due = await this.prisma.emailDigest.findMany({
      where: { pendingCount: { gt: 0 }, OR: [{ lastSentAt: null }, { lastSentAt: { lt: eligibleBefore } }] },
      select: { userId: true, type: true },
      take: 500
    });
    for (const d of due) {
      await this.maybeSend(d.userId, d.type as DigestType).catch(() => undefined);
    }
  }

  // Claim-and-send: atomically mark this (user,type) as sent-now if it is eligible
  // (avoids two concurrent events both emailing), then send and reset the counter.
  private async maybeSend(userId: string, type: DigestType) {
    const eligibleBefore = new Date(Date.now() - HOUR_MS);
    const claim = await this.prisma.emailDigest.updateMany({
      where: { userId, type, pendingCount: { gt: 0 }, OR: [{ lastSentAt: null }, { lastSentAt: { lt: eligibleBefore } }] },
      data: { lastSentAt: new Date() }
    });
    if (claim.count === 0) return; // not yet eligible, or already claimed elsewhere
    const digest = await this.prisma.emailDigest.findUnique({ where: { userId_type: { userId, type } } });
    const count = digest?.pendingCount || 0;
    if (count <= 0) return;
    const sent = await this.sendDigest(userId, type, count);
    if (sent) {
      await this.prisma.emailDigest.update({
        where: { userId_type: { userId, type } },
        data: { pendingCount: 0, firstPendingAt: null }
      });
    }
  }

  private async recipientWantsEmail(userId: string, type: DigestType): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, status: true, preferences: { select: { emailOnResponse: true, emailOnMessage: true } } }
    });
    if (!user?.email || !user.emailVerifiedAt) return false;
    if (["BANNED", "TEMP_BANNED", "DELETED"].includes(user.status)) return false;
    const prefs = user.preferences;
    if (!prefs) return true;
    return type === "RESPONSE" ? prefs.emailOnResponse : prefs.emailOnMessage;
  }

  private async sendDigest(userId: string, type: DigestType, count: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, preferences: { select: { emailOnResponse: true, emailOnMessage: true, unsubscribeToken: true } } }
    });
    if (!user?.email || !user.emailVerifiedAt) return true; // nothing to send, but clear the batch
    const prefs = user.preferences;
    const wants = type === "RESPONSE" ? prefs?.emailOnResponse : prefs?.emailOnMessage;
    if (prefs && !wants) return true; // unsubscribed since queueing — drop the batch

    const token = await this.ensureUnsubscribeToken(userId, prefs?.unsubscribeToken);
    const web = parsePublicWebOrigins(process.env.PUBLIC_WEB_URL)[0] || "http://localhost:3000";
    const unsubscribeUrl = `${web}/unsubscribe?token=${encodeURIComponent(token)}&type=${type === "RESPONSE" ? "response" : "message"}`;
    const body =
      type === "RESPONSE"
        ? responseDigestEmail({ count, listingsUrl: `${web}/me`, unsubscribeUrl })
        : messageDigestEmail({ count, inboxUrl: `${web}/me/inbox`, unsubscribeUrl });

    try {
      await sendTransactionalEmail({ to: user.email, ...body });
      return true;
    } catch (error) {
      this.logger.warn(`send ${type} digest to ${userId} failed: ${(error as Error)?.message || error}`);
      return false; // keep the batch; retried next flush
    }
  }

  private async ensureUnsubscribeToken(userId: string, existing?: string | null): Promise<string> {
    if (existing) return existing;
    const token = randomBytes(24).toString("hex");
    await this.prisma.userPreferences.update({ where: { userId }, data: { unsubscribeToken: token } }).catch(() => undefined);
    return token;
  }
}
