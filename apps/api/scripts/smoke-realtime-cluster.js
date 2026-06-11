// Verifies cross-instance realtime fan-out: a frame published to the shared
// Redis channel (exactly what broadcast() does on another API instance) is
// delivered to a WebSocket client connected to THIS instance. No DB writes.
// Usage: WS_URL=ws://host:4000/ws/chat REDIS_URL=redis://host:6379 node scripts/smoke-realtime-cluster.js
const WebSocket = require("ws");
const Redis = require("ioredis");

const WS_URL = process.env.WS_URL || "ws://127.0.0.1:4000/ws/chat";
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const CHANNEL = "cofind:chat:broadcast";

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

async function main() {
  console.log(`Cluster fan-out: WS ${WS_URL} <- Redis ${REDIS_URL}`);
  const ws = await connect(WS_URL);
  const marker = `rt-cluster-${Date.now()}`;
  let received = false;
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "chat.message.created" && msg.payload?.text === marker) received = true;
    } catch {
      // ignore
    }
  });

  const pub = new Redis(REDIS_URL, { maxRetriesPerRequest: 2 });
  await new Promise((r) => setTimeout(r, 250));
  const delivered = await pub.publish(CHANNEL, JSON.stringify({ type: "chat.message.created", payload: { text: marker } }));
  await new Promise((r) => setTimeout(r, 1200));
  ws.close();
  pub.disconnect();

  console.log(`  redis subscribers that got the publish: ${delivered}`);
  if (!received) {
    console.error("  FAIL cross-instance delivery: WS client did not receive the Redis-published frame");
    process.exit(1);
  }
  console.log("  ok   cross-instance fan-out (Redis publish -> WS client)");
  console.log("\nrealtime-cluster smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
