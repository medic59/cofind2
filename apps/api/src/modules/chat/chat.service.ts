import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sanitizeRichText } from "../../common/rich-text";
import { PrismaService } from "../prisma/prisma.service";
import { deleteUploadedImageByUrl } from "../uploads/upload-storage";
import { ReactMessageDto, SendGlobalMessageDto } from "./dto";

@Injectable()
export class ChatService {
  private readonly rooms = new Set(["general", "partners", "fandoms", "moderation"]);

  constructor(private readonly prisma: PrismaService) {}

  async messages(cursor?: string, viewerId?: string, room?: string) {
    const normalizedRoom = this.normalizeRoom(room);
    const messages = await this.prisma.globalChatMessage.findMany({
      where: {
        isDeleted: false,
        ...(normalizedRoom && normalizedRoom !== "general" ? { room: normalizedRoom } : {})
      },
      include: {
        sender: { select: { id: true, role: true, profile: true } },
        reactions: true,
        quotesAsMessage: true,
        drawings: true
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    return this.withLikes(messages, viewerId);
  }

  async send(senderId: string, dto: SendGlobalMessageDto) {
    await this.assertCanCommunicate(senderId);
    this.assertDrawingUrl(dto.drawingUrl);
    const legacy = this.extractLegacyRoom(dto.text || "");
    const room = this.normalizeRoom(dto.room || legacy.room);
    const text = sanitizeRichText(legacy.text);
    if (!text && !dto.drawingUrl) throw new BadRequestException("Message text is required");
    const messageText = text || "Отправлен рисунок с мини-холста";
    const quoted = dto.quotedGlobalMessageId
      ? await this.prisma.globalChatMessage.findFirst({ where: { id: dto.quotedGlobalMessageId, isDeleted: false } })
      : null;
    if (dto.quotedGlobalMessageId && !quoted) throw new BadRequestException("Quoted message is not available");

    const message = await this.prisma.globalChatMessage.create({
      data: {
        senderId,
        room,
        text: messageText,
        quotesAsMessage: quoted
          ? {
              create: {
                quotedGlobalMessageId: quoted.id,
                quotedTextSnapshot: quoted.text
              }
            }
          : undefined,
        drawings: dto.drawingUrl
          ? {
              create: {
                userId: senderId,
                imageUrl: dto.drawingUrl
              }
            }
          : undefined
      },
      include: {
        sender: { select: { id: true, role: true, profile: true } },
        reactions: true,
        quotesAsMessage: true,
        drawings: true
      }
    });
    return { ...message, likes: 0 };
  }

  async react(userId: string, messageId: string, dto: ReactMessageDto) {
    const message = await this.prisma.globalChatMessage.findFirst({ where: { id: messageId, isDeleted: false } });
    if (!message) throw new NotFoundException("Message not found");

    const where = {
      globalMessageId_userId_emoji: {
        globalMessageId: messageId,
        userId,
        emoji: dto.emoji
      }
    };
    const existing = await this.prisma.messageReaction.findUnique({ where });
    if (existing) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
      return { reacted: false, emoji: dto.emoji, count: await this.countReactions(messageId, dto.emoji), removedReactions: [] };
    }
    const replaced = await this.prisma.messageReaction.findMany({
      where: { globalMessageId: messageId, userId },
      select: { id: true, emoji: true }
    });
    await this.prisma.$transaction([
      this.prisma.messageReaction.deleteMany({ where: { globalMessageId: messageId, userId } }),
      this.prisma.messageReaction.create({ data: { globalMessageId: messageId, userId, emoji: dto.emoji } })
    ]);
    const removedReactions = await Promise.all(
      [...new Set(replaced.map((reaction) => reaction.emoji))]
        .filter((emoji) => emoji !== dto.emoji)
        .map(async (emoji) => ({ emoji, count: await this.countReactions(messageId, emoji) }))
    );
    return { reacted: true, emoji: dto.emoji, count: await this.countReactions(messageId, dto.emoji), removedReactions };
  }

  async like(userId: string, messageId: string) {
    const message = await this.prisma.globalChatMessage.findFirst({ where: { id: messageId, isDeleted: false }, select: { id: true } });
    if (!message) throw new NotFoundException("Message not found");
    const existing = await this.prisma.like.findUnique({
      where: { userId_entityType_entityId: { userId, entityType: "GLOBAL_CHAT_MESSAGE", entityId: messageId } }
    });
    if (existing) {
      await this.prisma.like.delete({ where: { id: existing.id } });
      return { liked: false, likes: await this.countLikes("GLOBAL_CHAT_MESSAGE", messageId) };
    }
    await this.prisma.like.create({ data: { userId, entityType: "GLOBAL_CHAT_MESSAGE", entityId: messageId } });
    return { liked: true, likes: await this.countLikes("GLOBAL_CHAT_MESSAGE", messageId) };
  }

  async deleteOwn(userId: string, messageId: string) {
    const message = await this.prisma.globalChatMessage.findFirst({
      where: { id: messageId, senderId: userId, isDeleted: false },
      select: { id: true, drawings: { select: { imageUrl: true } } }
    });
    if (!message) throw new NotFoundException("Message not found");
    const updated = await this.prisma.globalChatMessage.update({
      where: { id: messageId },
      data: { isDeleted: true, deletedAt: new Date() }
    });
    await Promise.all(message.drawings.map((drawing) => deleteUploadedImageByUrl(drawing.imageUrl)));
    return updated;
  }

  private async assertCanCommunicate(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status === "MUTED") throw new ForbiddenException("User is muted");
  }

  private assertDrawingUrl(value?: string) {
    if (!value) return;
    if (value.length > 500_000 || !/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(value)) {
      throw new BadRequestException("Drawing URL is invalid");
    }
  }

  private normalizeRoom(room?: string) {
    const normalized = String(room || "general").trim().toLowerCase();
    return this.rooms.has(normalized) ? normalized : "general";
  }

  private extractLegacyRoom(text: string) {
    const value = String(text || "").trim();
    const match = value.match(/^\[#([a-z0-9-]+)\]\s*/i);
    if (!match) return { room: undefined, text: value };
    return {
      room: match[1].toLowerCase(),
      text: value.slice(match[0].length)
    };
  }

  private countLikes(entityType: string, entityId: string) {
    return this.prisma.like.count({ where: { entityType, entityId } });
  }

  private countReactions(globalMessageId: string, emoji: string) {
    return this.prisma.messageReaction.count({ where: { globalMessageId, emoji } });
  }

  private async withLikes<T extends { id: string }>(messages: T[], viewerId?: string) {
    const ids = messages.map((message) => message.id);
    const [likes, viewerLikes, viewerReactions] = ids.length
      ? await Promise.all([
          this.prisma.like.groupBy({
            by: ["entityId"],
            where: { entityType: "GLOBAL_CHAT_MESSAGE", entityId: { in: ids } },
            _count: { _all: true }
          }),
          viewerId
            ? this.prisma.like.findMany({
                where: { userId: viewerId, entityType: "GLOBAL_CHAT_MESSAGE", entityId: { in: ids } },
                select: { entityId: true }
              })
            : [],
          viewerId
            ? this.prisma.messageReaction.findMany({
                where: { userId: viewerId, globalMessageId: { in: ids } },
                select: { globalMessageId: true, emoji: true }
              })
            : []
        ])
      : [[], [], []];
    const likesById = new Map(likes.map((item) => [item.entityId, item._count._all]));
    const likedByViewer = new Set(viewerLikes.map((item) => item.entityId));
    const reactedByViewer = new Map<string, Record<string, boolean>>();
    for (const reaction of viewerReactions) {
      if (!reaction.globalMessageId) continue;
      reactedByViewer.set(reaction.globalMessageId, {
        ...(reactedByViewer.get(reaction.globalMessageId) || {}),
        [reaction.emoji]: true
      });
    }
    return messages.map((message) => ({
      ...message,
      likes: likesById.get(message.id) || 0,
      likedByMe: likedByViewer.has(message.id),
      reactedByMe: reactedByViewer.get(message.id) || {}
    }));
  }
}
