// Resolves the header auth state from a server-set, readable hint cookie
// (`cofind_auth`). Runs in <head> as a classic script so it sets
// <html data-auth-state> before the body paints — no flicker, no inline script
// (the CSP forbids inline scripts). Also exported as pure functions for tests.
(function (root) {
  function parseCookie(cookieString, name) {
    var match = new RegExp("(?:^|;\\s*)" + name + "=([^;]*)").exec(String(cookieString || ""));
    return match ? match[1] : undefined;
  }

  // Server-authoritative: the hint cookie mirrors the lifetime of the HttpOnly
  // session cookie, so its presence is the single source of truth at boot.
  // Stale localStorage tokens (without a live session) must NOT count as logged in.
  function resolveAuthState(cookieString) {
    return parseCookie(cookieString, "cofind_auth") === "1" ? "user" : "guest";
  }

  function headerVisibility(state) {
    var user = state === "user";
    return {
      login: !user, // «Войти» — guests only
      profile: user, // «Личный кабинет» + profile button
      inbox: user, // «Сообщения»
      logout: user // «Выйти»
    };
  }

  if (typeof document !== "undefined") {
    document.documentElement.dataset.authState = resolveAuthState(document.cookie);
  }

  root.cofindAuthState = { resolveAuthState, headerVisibility, parseCookie };
})(typeof window !== "undefined" ? window : globalThis);
