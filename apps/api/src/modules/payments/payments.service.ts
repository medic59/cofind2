import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { PaymentStatus } from "@prisma/client";
import { timingSafeEqual } from "crypto";
import { isMonetizationEnabled } from "../../common/system-settings";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentWebhookDto } from "./dto";

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async webhook(dto: PaymentWebhookDto, providedSecret?: string) {
    this.verifyWebhookSecret(providedSecret);
    if (!(await isMonetizationEnabled(this.prisma))) {
      throw new ForbiddenException("Paid features are not enabled yet");
    }
    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
      include: { plan: true }
    });
    if (!payment) throw new NotFoundException("Payment not found");

    if (payment.status !== PaymentStatus.PENDING) {
      const subscription = await this.prisma.userSubscription.findUnique({
        where: { userId: payment.userId },
        include: { plan: true }
      });
      return { payment, subscription, duplicate: true };
    }

    const updatedPayment = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: dto.status,
        providerPaymentId: dto.providerPaymentId || payment.providerPaymentId
      },
      include: { plan: true }
    });

    if (dto.status === PaymentStatus.SUCCEEDED) {
      if (!payment.plan) throw new BadRequestException("Payment has no subscription plan");
      const now = new Date();
      const current = await this.prisma.userSubscription.findUnique({ where: { userId: payment.userId } });
      const base = current && current.expiresAt > now ? current.expiresAt : now;
      const expiresAt = new Date(base.getTime() + payment.plan.durationDays * 86_400_000);

      const subscription = await this.prisma.userSubscription.upsert({
        where: { userId: payment.userId },
        create: {
          userId: payment.userId,
          planId: payment.plan.id,
          status: "ACTIVE",
          startedAt: now,
          expiresAt
        },
        update: {
          planId: payment.plan.id,
          status: "ACTIVE",
          canceledAt: null,
          expiresAt
        },
        include: { plan: true }
      });

      await this.prisma.user.update({
        where: { id: payment.userId },
        data: { isPremium: true }
      });

      await this.prisma.notification.create({
        data: {
          userId: payment.userId,
          type: "SYSTEM",
          title: "Premium активирован",
          description: `Подписка "${payment.plan.name}" активна до ${expiresAt.toLocaleDateString("ru-RU")}.`,
          linkPath: "/me/subscription"
        }
      });

      return { payment: updatedPayment, subscription };
    }

    return { payment: updatedPayment, subscription: null };
  }

  private verifyWebhookSecret(providedSecret?: string) {
    const expected = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
    if (!expected && process.env.NODE_ENV !== "production") return;
    if (!expected || !providedSecret || !safeEqual(expected, providedSecret)) {
      throw new UnauthorizedException("Invalid payment webhook signature");
    }
  }
}

function safeEqual(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
