import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sanitizeRichText, richPlainTextLength, richTextLength } from "../../common/rich-text";
import { NotificationEmailService } from "../notifications/notification-email.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateConversationDto, SendMessageDto } from "./dto";

const conversationInclude = {
  participants: {
    include: {
      user: {
        select: {
          id: true,
          role: true,
          status: true,
          isPremium: true,
          profile: true
        }
      }
    }
  },
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: { sender: { select: { id: true, profile: true } } }
  }
};

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationEmail: NotificationEmailService
  ) {}

  async create(userId: string, dto: CreateConversationDto) {
    await this.assertCanCommunicate(userId);
    const participantIds = [...new Set([userId, ...dto.participantIds])];
    if (participantIds.length < 2) throw new ForbiddenException("Conversation needs at least two participants");
    await this.assertUsersAvailable(participantIds);
    await this.assertNoBlocks(participantIds);

    const conversation = await this.prisma.conversation.create({
      data: {
        participants: {
          create: participantIds.map((participantId) => ({ userId: participantId }))
        },
        messages: dto.initialMessage
          ? {
              create: {
                senderId: userId,
                text: this.safeMessageText(dto.initialMessage)
              }
            }
          : undefined
      },
      include: conversationInclude
    });
    if (dto.initialMessage) {
      for (const pid of participantIds) {
        if (pid !== userId) void this.notificationEmail.queueMessage(pid);
      }
    }
    return conversation;
  }

  async list(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: conversationInclude,
      orderBy: { updatedAt: "desc" },
      take: 100
    });
    return Promise.all(
      conversations.map(async (conversation) => {
        const participant = conversation.participants.find((item) => item.userId === userId);
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: userId },
            isDeleted: false,
            ...(participant?.lastReadAt ? { createdAt: { gt: participant.lastReadAt } } : {})
          }
        });
        return { ...conversation, unreadCount };
      })
    );
  }

  async messages(userId: string, conversationId: string, cursor?: string) {
    await this.assertParticipant(userId, conversationId);
    if (cursor) {
      const cursorMessage = await this.prisma.message.findFirst({
        where: { id: cursor, conversationId, isDeleted: false },
        select: { id: true }
      });
      if (!cursorMessage) throw new NotFoundException("Message cursor not found");
    }
    const messages = await this.prisma.message.findMany({
      where: { conversationId, isDeleted: false },
      include: { sender: { select: { id: true, role: true, profile: true } }, reactions: true, drawings: true },
      orderBy: { createdAt: "desc" },
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    return messages.reverse();
  }

  async send(userId: string, conversationId: string, dto: SendMessageDto) {
    await this.assertCanCommunicate(userId);
    await this.assertParticipant(userId, conversationId);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true }
    });
    const participantIds = participants.map((participant) => participant.userId);
    await this.assertUsersAvailable(participantIds);
    await this.assertNoBlocks(participantIds);
    const text = this.safeMessageText(dto.text);
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          senderId: userId,
          text
        },
        include: { sender: { select: { id: true, role: true, profile: true } } }
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return created;
    });
    // Notify the other participants by email (grouped, best-effort).
    for (const pid of participantIds) {
      if (pid !== userId) void this.notificationEmail.queueMessage(pid);
    }
    return message;
  }

  async deleteOwn(userId: string, conversationId: string, messageId: string) {
    await this.assertParticipant(userId, conversationId);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, senderId: userId, isDeleted: false },
      select: { id: true }
    });
    if (!message) throw new NotFoundException("Message not found");
    return this.prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true }
    });
  }

  async read(userId: string, conversationId: string) {
    await this.assertParticipant(userId, conversationId);
    return this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() }
    });
  }

  async ensureBetween(userId: string, otherUserId: string, initialMessage?: string) {
    if (userId === otherUserId) throw new ForbiddenException("You cannot start a direct conversation with yourself");
    const existing = await this.prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: otherUserId } } }
        ]
      },
      include: conversationInclude
    });
    if (existing) {
      if (initialMessage) {
        await this.send(userId, existing.id, { text: initialMessage });
        return this.prisma.conversation.findUnique({
          where: { id: existing.id },
          include: conversationInclude
        });
      }
      return existing;
    }
    const target = await this.prisma.user.findUnique({
      where: { id: otherUserId },
      select: { profile: { select: { privacySettings: true } } }
    });
    const privacy = target?.profile?.privacySettings && typeof target.profile.privacySettings === "object" && !Array.isArray(target.profile.privacySettings)
      ? target.profile.privacySettings as Record<string, unknown>
      : {};
    if (privacy.allowProfileMessages === false) {
      throw new ForbiddenException("User disabled new profile messages");
    }
    return this.create(userId, { participantIds: [otherUserId], initialMessage });
  }

  private safeMessageText(value: string) {
    const sanitized = sanitizeRichText(value);
    if (richPlainTextLength(sanitized) < 1) throw new BadRequestException("Message text is required");
    if (richTextLength(sanitized) > 4000) throw new BadRequestException("Message text is too long");
    return sanitized;
  }

  private async assertParticipant(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } }
    });
    if (!participant) throw new NotFoundException("Conversation not found");
    return participant;
  }

  private async assertNoBlocks(userIds: string[]) {
    const pairs = userIds.flatMap((blockerId) =>
      userIds.filter((blockedId) => blockedId !== blockerId).map((blockedId) => ({ blockerId, blockedId }))
    );
    if (!pairs.length) return;
    const block = await this.prisma.userBlock.findFirst({
      where: { OR: pairs },
      select: { id: true }
    });
    if (block) throw new ForbiddenException("Interaction is blocked");
  }

  private async assertUsersAvailable(userIds: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, status: true } });
    if (users.length !== userIds.length) throw new NotFoundException("User not found");
    if (users.some((user) => ["BANNED", "TEMP_BANNED", "DELETED"].includes(user.status))) {
      throw new ForbiddenException("User is not available");
    }
  }

  private async assertCanCommunicate(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, emailVerifiedAt: true } });
    if (!user || user.status === "MUTED") throw new ForbiddenException("User is muted");
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ error: "EMAIL_NOT_VERIFIED", message: "Подтвердите e-mail, чтобы писать сообщения" });
    }
  }
}
