// Initializes Sentry (browser) when a DSN is present. Loaded after
// /vendor/sentry.min.js. Config comes from <meta> tags injected at build time;
// without a DSN this is a no-op. Kept as an external file because the site CSP
// is script-src 'self' (no inline scripts).
(function () {
  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? el.getAttribute("content") || "" : "";
  }
  var dsn = meta("cofind-sentry-dsn");
  if (!dsn || !window.Sentry || typeof window.Sentry.init !== "function") return;
  window.Sentry.init({
    dsn: dsn,
    release: meta("cofind-sentry-release") || undefined,
    environment: meta("cofind-sentry-environment") || "production",
    tracesSampleRate: Number(meta("cofind-sentry-traces-rate")) || 0,
    sendDefaultPii: false
  });
})();
