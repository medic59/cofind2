// Verifies the realtime component: /health/ready reports it, and the WS server
// at /ws/chat actually upgrades and greets with chat.ready.
// Usage: API_BASE=http://127.0.0.1:4000/api/v1 node scripts/smoke-realtime.js
const WebSocket = require("ws");

const API_BASE = (process.env.API_BASE || "http://localhost:4000/api/v1").replace(/\/+$/, "");
const WS_URL = API_BASE.replace(/^http/i, "ws").replace(/\/api\/v1\/?$/, "/ws/chat");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

function handshake() {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let opened = false;
    let ready = false;
    const done = () => {
      try { ws.close(); } catch {}
      resolve({ opened, ready });
    };
    const timer = setTimeout(done, 5000);
    ws.on("open", () => { opened = true; });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "chat.ready") {
          ready = true;
          clearTimeout(timer);
          done();
        }
      } catch {
        // ignore non-JSON frames
      }
    });
    ws.on("error", () => { clearTimeout(timer); done(); });
  });
}

async function main() {
  console.log(`Realtime smoke against ${API_BASE} (ws: ${WS_URL})\n`);

  const res = await fetch(`${API_BASE}/health/ready`, { headers: { Accept: "application/json" } });
  const body = await res.json();
  check("/health/ready 200", res.status === 200, `status=${res.status}`);
  check("/health/ready exposes realtime dependency", Boolean(body?.dependencies?.realtime));
  check("realtime.ok === true", body?.dependencies?.realtime?.ok === true, JSON.stringify(body?.dependencies?.realtime));
  check("realtime.path === /ws/chat", body?.dependencies?.realtime?.path === "/ws/chat");
  check("realtime.clients is a number", typeof body?.dependencies?.realtime?.clients === "number");

  const { opened, ready } = await handshake();
  check("WS /ws/chat upgrades (open)", opened);
  check("WS sends chat.ready frame", ready);

  if (failures > 0) {
    console.error(`\nrealtime smoke FAILED (${failures} check(s))`);
    process.exit(1);
  }
  console.log("\nrealtime smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
