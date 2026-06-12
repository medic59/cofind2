import * as Sentry from "@sentry/node";

// Sentry is fully DSN-driven: without SENTRY_DSN nothing initializes and every
// helper below is a no-op, so the API runs identically with or without it.
let enabled = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE || undefined,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    // Performance tracing is opt-in (0 by default) to keep overhead at zero
    // until a sample rate is configured.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    sendDefaultPii: false
  });
  enabled = true;
}

export function isSentryEnabled() {
  return enabled;
}

export type CaptureContext = {
  requestId?: string;
  path?: string;
  method?: string;
  status?: number;
};

// Report an exception with request correlation. Safe to call when Sentry is off.
export function captureException(error: unknown, context: CaptureContext = {}) {
  if (!enabled) return;
  Sentry.captureException(error, {
    tags: { request_id: context.requestId, http_status: context.status },
    extra: { path: context.path, method: context.method }
  });
}

// Correlate a message (non-exception) with the current request.
export function captureMessage(message: string, context: CaptureContext = {}) {
  if (!enabled) return;
  Sentry.captureMessage(message, { level: "warning", tags: { request_id: context.requestId } });
}
