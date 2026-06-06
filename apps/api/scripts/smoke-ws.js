const WebSocket = require("ws");

const API_BASE = process.env.API_BASE || "http://localhost:4000/api/v1";
const WS_BASE = API_BASE.replace(/^http/i, "ws").replace(/\/api\/v1\/?$/, "/ws/chat");
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${text}`);
  return body;
}

async function main() {
  const session = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "mira@cofind.local", password: "password123" })
  });

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(session.accessToken)}`);
    const timer = setTimeout(() => reject(new Error("WebSocket smoke timed out")), 8000);

    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "chat.message", room: "partners", text: `WS smoke ${new Date().toISOString()}` }));
    });

    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "chat.message.created") {
        clearTimeout(timer);
        socket.close();
        if (event.payload.room !== "partners") {
          reject(new Error("Expected WebSocket message room to be persisted"));
          return;
        }
        resolve(event.payload);
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(session.accessToken)}`);
    const timer = setTimeout(() => reject(new Error("WebSocket drawing smoke timed out")), 8000);

    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "chat.message",
        text: `WS drawing smoke ${new Date().toISOString()}`,
        drawingUrl: TINY_PNG
      }));
    });

    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "chat.message.created" && event.payload.text.startsWith("WS drawing smoke")) {
        clearTimeout(timer);
        socket.close();
        if (event.payload.drawings?.[0]?.imageUrl !== TINY_PNG) {
          reject(new Error("Expected WebSocket drawing to be persisted"));
          return;
        }
        resolve(event.payload);
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(session.accessToken)}`);
    const timer = setTimeout(() => reject(new Error("WebSocket drawing-only smoke timed out")), 8000);

    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "chat.message",
        drawingUrl: TINY_PNG
      }));
    });

    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "chat.message.created" && event.payload.text === "Отправлен рисунок с мини-холста") {
        clearTimeout(timer);
        socket.close();
        if (event.payload.drawings?.[0]?.imageUrl !== TINY_PNG) {
          reject(new Error("Expected WebSocket drawing-only message to persist drawing URL"));
          return;
        }
        resolve(event.payload);
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(session.accessToken)}`);
    const timer = setTimeout(() => reject(new Error("WebSocket invalid drawing smoke timed out")), 8000);

    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "chat.message",
        text: "WS invalid drawing should fail",
        drawingUrl: "javascript:alert(1)"
      }));
    });

    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "chat.error") {
        clearTimeout(timer);
        socket.close();
        if (!String(event.payload?.message || "").includes("Drawing URL")) {
          reject(new Error("Expected invalid drawing WebSocket error to explain drawing URL"));
          return;
        }
        resolve(event.payload);
      }
      if (event.type === "chat.message.created" && event.payload.text === "WS invalid drawing should fail") {
        clearTimeout(timer);
        socket.close();
        reject(new Error("Expected invalid WebSocket drawing to fail"));
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  const deletedMessage = await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: "WS smoke deleted quote source" })
  });
  await request(`/chat/messages/${deletedMessage.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(session.accessToken)}`);
    const timer = setTimeout(() => reject(new Error("WebSocket deleted quote smoke timed out")), 8000);

    socket.on("open", () => {
      socket.send(JSON.stringify({
        type: "chat.message",
        text: "WS smoke deleted quote should fail",
        quotedGlobalMessageId: deletedMessage.id
      }));
    });

    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "chat.error") {
        clearTimeout(timer);
        socket.close();
        resolve(event.payload);
      }
      if (event.type === "chat.message.created") {
        clearTimeout(timer);
        socket.close();
        reject(new Error("Expected WebSocket quote of deleted message to fail"));
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  console.log(`WebSocket smoke OK: ${WS_BASE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
