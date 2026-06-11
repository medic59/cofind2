import { Injectable, Logger } from "@nestjs/common";
import { verify } from "jsonwebtoken";
import { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { PrismaService } from "../prisma/prisma.service";
import { ChatService } from "./chat.service";

type SocketUser = {
  id: string;
  email: string;
  role: string;
  status: string;
};

type ClientMessage =
  | { type: "chat.ping" }
  | { type: "chat.message"; token?: string; room?: string; text?: string; quotedGlobalMessageId?: string; drawingUrl?: string };

@Injectable()
export class ChatRealtimeService {
  private readonly logger = new Logger(ChatRealtimeService.name);
  private server?: WebSocketServer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService
  ) {}

  attach(httpServer: unknown) {
    if (this.server) return;
    this.server = new WebSocketServer({ server: httpServer as never, path: "/ws/chat" });
    this.server.on("connection", (socket, request) => this.handleConnection(socket, request));
    this.logger.log("WebSocket chat attached at /ws/chat");
  }

  // Readiness of the realtime component: the WS server is attached to the HTTP
  // server and accepting upgrades at /ws/chat.
  status() {
    return {
      ok: Boolean(this.server),
      path: "/ws/chat",
      clients: this.server ? this.server.clients.size : 0
    };
  }

  broadcast(type: string, payload: unknown) {
    const message = JSON.stringify({ type, payload });
    for (const client of this.server?.clients || []) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage) {
    const token = this.tokenFromRequest(request);
    const user = token ? this.verifyToken(token) : null;
    socket.send(JSON.stringify({ type: "chat.ready", payload: { authenticated: Boolean(user) } }));

    socket.on("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientMessage;
        if (message.type === "chat.ping") {
          socket.send(JSON.stringify({ type: "chat.pong", payload: { at: new Date().toISOString() } }));
          return;
        }
        if (message.type === "chat.message") {
          const messageUser = user || this.verifyToken(message.token);
          if (!messageUser) {
            socket.send(JSON.stringify({ type: "chat.error", payload: { message: "Authentication required" } }));
            return;
          }
          const created = await this.createGlobalMessage(messageUser.id, message.text, message.quotedGlobalMessageId, message.drawingUrl, message.room);
          this.broadcast("chat.message.created", created);
        }
      } catch (error) {
        socket.send(JSON.stringify({ type: "chat.error", payload: { message: error instanceof Error ? error.message : "Invalid realtime payload" } }));
      }
    });
  }

  private async createGlobalMessage(senderId: string, text?: string, quotedGlobalMessageId?: string, drawingUrl?: string, room?: string) {
    const trimmed = String(text || "").trim();
    if (!trimmed && !drawingUrl) throw new Error("Message text is required");
    await this.assertCanUseRealtime(senderId);
    return this.chat.send(senderId, {
      text: trimmed.slice(0, 4000) || undefined,
      room,
      quotedGlobalMessageId,
      drawingUrl
    });
  }

  private async assertCanUseRealtime(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        bansReceived: {
          where: {
            revokedAt: null,
            type: { in: ["TEMP_BAN", "PERMANENT_BAN"] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
          },
          take: 1
        }
      }
    });
    if (!user || ["BANNED", "DELETED", "TEMP_BANNED"].includes(user.status) || user.bansReceived.length) {
      throw new Error("User is blocked");
    }
  }

  private tokenFromRequest(request: IncomingMessage) {
    const url = new URL(request.url || "/", "http://localhost");
    return url.searchParams.get("token") || undefined;
  }

  private verifyToken(token?: string): SocketUser | null {
    if (!token) return null;
    try {
      return verify(token, process.env.JWT_ACCESS_SECRET || "dev-access-secret") as SocketUser;
    } catch {
      return null;
    }
  }
}
