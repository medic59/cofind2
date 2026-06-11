// Unit tests for the header auth-state resolution (guest vs. user).
// Executes the real browser boot script in a sandbox so there is no logic drift.
// Run: node scripts/auth-state.test.js
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const code = readFileSync(resolve(root, "auth-state.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox); // no `document` -> the boot side effect is skipped
vm.runInContext(code, sandbox);
const { resolveAuthState, headerVisibility } = sandbox.cofindAuthState;

let passed = 0;
function it(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok   ${name}`);
}

// --- Guest state ---
it("no cookies -> guest", () => {
  assert.equal(resolveAuthState(""), "guest");
});
it("unrelated cookies -> guest", () => {
  assert.equal(resolveAuthState("theme=dark; lang=ru"), "guest");
});
it("stale HttpOnly session cookies (invisible to JS) without hint -> guest", () => {
  assert.equal(resolveAuthState("cofind_access=abc; cofind_session=def"), "guest");
});
it("guest header shows only login", () => {
  assert.deepEqual(headerVisibility("guest"), {
    login: true,
    profile: false,
    inbox: false,
    logout: false
  });
});

// --- User state ---
it("hint cookie present -> user", () => {
  assert.equal(resolveAuthState("cofind_auth=1"), "user");
});
it("hint cookie among others -> user", () => {
  assert.equal(resolveAuthState("theme=dark; cofind_auth=1; lang=ru"), "user");
});
it("user header shows profile, inbox, logout and hides login", () => {
  assert.deepEqual(headerVisibility("user"), {
    login: false,
    profile: true,
    inbox: true,
    logout: true
  });
});

console.log(`\nauth-state: ${passed} checks passed`);
