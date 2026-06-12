import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
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

// Per-connection state attached to each live socket.
type LiveSocket = WebSocket & { isAlive?: boolean; sendTimes?: number[]; userId?: string };

const BROADCAST_CHANNEL = "cofind:chat:broadcast";
const MAX_BUFFERED_BYTES = 1 << 20; // 1MB: drop clients that can't keep up
const HEARTBEAT_INTERVAL_MS = 30_000;
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MAX_MESSAGES = 15; // per connection per window
const MAX_CONNECTIONS = Number(process.env.CHAT_MAX_CONNECTIONS || 20_000);

@Injectable()
export class ChatRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatRealtimeService.name);
  private server?: WebSocketServer;
  private heartbeat?: ReturnType<typeof setInterval>;
  private pub?: Redis;
  private sub?: Redis;
  private redisReady = false;
  // Monotonic counters surfaced in status() for dashboards/alerts (WS error rate).
  private readonly metrics = {
    connections: 0,
    disconnects: 0,
    errorFrames: 0,
    socketErrors: 0,
    droppedBackpressure: 0,
    rejectedOverload: 0
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService
  ) {}

  // Wire Redis pub/sub so a message created on ANY API instance is delivered to
  // the WebSocket clients of EVERY instance. Without REDIS_URL the service runs
  // in single-process mode (direct in-memory broadcast).
  onModuleInit() {
    const url = process.env.REDIS_URL || process.env.REDIS_HOST_URL;
    if (!url) {
      this.logger.log("Realtime running in single-process mode (no REDIS_URL)");
      return;
    }
    const options = { lazyConnect: false, maxRetriesPerRequest: null as null, enableReadyCheck: true };
    this.pub = new Redis(url, options);
    this.sub = new Redis(url, options);
    this.pub.on("ready", () => { this.redisReady = true; this.logger.log("Realtime Redis publisher ready"); });
    this.pub.on("end", () => { this.redisReady = false; });
    this.pub.on("error", (error) => this.logger.warn(`Realtime Redis publisher error: ${error.message}`));
    this.sub.on("error", (error) => this.logger.warn(`Realtime Redis subscriber error: ${error.message}`));
    this.sub.subscribe(BROADCAST_CHANNEL).catch((error) => this.logger.warn(`Realtime Redis subscribe failed: ${error.message}`));
    this.sub.on("message", (channel, message) => {
      if (channel === BROADCAST_CHANNEL) this.localBroadcast(message);
    });
  }

  onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.server?.clients || []) {
      try { client.close(1001, "Server shutting down"); } catch { /* ignore */ }
    }
    this.server?.close();
    this.pub?.disconnect();
    this.sub?.disconnect();
  }

  attach(httpServer: unknown) {
    if (this.server) return;
    this.server = new WebSocketServer({ server: httpServer as never, path: "/ws/chat", maxPayload: 512 * 1024 });
    this.server.on("connection", (socket, request) => this.handleConnection(socket as LiveSocket, request));
    // Heartbeat: ping every interval, terminate sockets that didn't pong.
    this.heartbeat = setInterval(() => {
      for (const client of this.server?.clients || []) {
        const live = client as LiveSocket;
        if (live.isAlive === false) {
          live.terminate();
          continue;
        }
        live.isAlive = false;
        try { live.ping(); } catch { /* ignore */ }
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref?.();
    this.logger.log("WebSocket chat attached at /ws/chat");
  }

  // Readiness of the realtime component for /health/ready.
  status() {
    return {
      ok: Boolean(this.server),
      path: "/ws/chat",
      clients: this.server ? this.server.clients.size : 0,
      redis: this.pub ? (this.redisReady ? "connected" : "disconnected") : "disabled",
      metrics: { ...this.metrics }
    };
  }

  // Publish across the cluster (every instance, including this one, delivers via
  // the subscriber). Falls back to a direct local broadcast if Redis is down.
  broadcast(type: string, payload: unknown) {
    const message = JSON.stringify({ type, payload });
    if (this.pub && this.redisReady) {
      this.pub.publish(BROADCAST_CHANNEL, message).catch(() => this.localBroadcast(message));
    } else {
      this.localBroadcast(message);
    }
  }

  // Deliver a serialized frame to this instance's connected clients, with
  // backpressure: clients that can't drain their buffer are dropped.
  private localBroadcast(message: string) {
    for (const client of this.server?.clients || []) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        this.metrics.droppedBackpressure += 1;
        (client as LiveSocket).terminate();
        continue;
      }
      try {
        client.send(message);
      } catch { /* socket closing */ }
    }
  }

  private handleConnection(socket: LiveSocket, request: IncomingMessage) {
    if (this.server && this.server.clients.size > MAX_CONNECTIONS) {
      this.metrics.rejectedOverload += 1;
      socket.close(1013, "Server overloaded");
      return;
    }
    const token = this.tokenFromRequest(request);
    const user = token ? this.verifyToken(token) : null;
    socket.isAlive = true;
    socket.sendTimes = [];
    socket.userId = user?.id;
    socket.on("pong", () => { socket.isAlive = true; });
    this.metrics.connections += 1;
    socket.on("close", () => { this.metrics.disconnects += 1; });
    socket.on("error", () => { this.metrics.socketErrors += 1; });
    socket.send(JSON.stringify({ type: "chat.ready", payload: { authenticated: Boolean(user) } }));

    socket.on("message", async (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientMessage;
        if (message.type === "chat.ping") {
          socket.isAlive = true;
          socket.send(JSON.stringify({ type: "chat.pong", payload: { at: new Date().toISOString() } }));
          return;
        }
        if (message.type === "chat.message") {
          const messageUser = user || this.verifyToken(message.token);
          if (!messageUser) {
            this.sendError(socket, "Authentication required", "AUTH_REQUIRED");
            return;
          }
          if (!this.allowSend(socket)) {
            this.sendError(socket, "Слишком много сообщений, подождите немного", "RATE_LIMITED");
            return;
          }
          const created = await this.createGlobalMessage(messageUser.id, message.text, message.quotedGlobalMessageId, message.drawingUrl, message.room);
          this.broadcast("chat.message.created", created);
        }
      } catch (error) {
        this.sendError(socket, error instanceof Error ? error.message : "Invalid realtime payload");
      }
    });
  }

  // Send a chat.error frame and count it (WS error-rate metric for alerting).
  private sendError(socket: LiveSocket, message: string, code?: string) {
    this.metrics.errorFrames += 1;
    try {
      socket.send(JSON.stringify({ type: "chat.error", payload: { message, ...(code ? { code } : {}) } }));
    } catch {
      /* socket closing */
    }
  }

  // Per-connection sliding-window flood control.
  private allowSend(socket: LiveSocket) {
    const now = Date.now();
    socket.sendTimes = (socket.sendTimes || []).filter((time) => now - time < FLOOD_WINDOW_MS);
    if (socket.sendTimes.length >= FLOOD_MAX_MESSAGES) return false;
    socket.sendTimes.push(now);
    return true;
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
