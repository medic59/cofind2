const { readFile } = require("node:fs/promises");

const files = {
  html: "apps/web/index.html",
  css: "apps/web/styles.css",
  app: "apps/web/app.js"
};

function fail(message) {
  throw new Error(message);
}

function assertIncludes(source, needles, label) {
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length) fail(`${label} missing: ${missing.join(", ")}`);
}

function assertNoFontViewportScaling(css) {
  const offenders = css
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /^font-size\s*:/.test(line) && /\b(vw|vh|vmin|vmax)\b/.test(line));
  if (offenders.length) {
    fail(`font-size must not scale with viewport units: ${offenders.map((item) => `${item.number}: ${item.line}`).join("; ")}`);
  }
}

function assertNoNonZeroLetterSpacing(css) {
  const offenders = css
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /^letter-spacing\s*:/.test(line) && !/^letter-spacing\s*:\s*0\s*;?$/.test(line));
  if (offenders.length) {
    fail(`letter-spacing must stay 0: ${offenders.map((item) => `${item.number}: ${item.line}`).join("; ")}`);
  }
}

async function main() {
  const [html, css, app] = await Promise.all([
    readFile(files.html, "utf8"),
    readFile(files.css, "utf8"),
    readFile(files.app, "utf8")
  ]);

  assertNoFontViewportScaling(css);
  assertNoNonZeroLetterSpacing(css);

  assertIncludes(
    html,
    [
      'class="skip-link"',
      'id="main-content"',
      'aria-live="polite"',
      'aria-label="Основная навигация"',
      'aria-label="Форматирование сообщения"',
      'decoding="async"'
    ],
    "index.html accessibility/visual contract"
  );

  assertIncludes(
    css,
    [
      "button:focus-visible",
      ".rich-editor:focus-visible",
      "overflow-wrap: anywhere",
      "@media (max-width: 920px)",
      "@media (max-width: 720px)",
      "@media (max-width: 560px)",
      "min-width: 680px",
      ".appearance-grid > *",
      ".preview-shell",
      "width: min(100%, 620px)",
      "-webkit-overflow-scrolling: touch",
      "aspect-ratio: 16 / 9",
      "min-height: 44px"
    ],
    "styles.css UX contract"
  );

  assertIncludes(
    app,
    [
      "function optimizeImageDataUrl",
      "function prepareImageDataUrl",
      "loading=\"lazy\" decoding=\"async\"",
      "function updateAdminRoleNote",
      "function autoGrowRichEditor",
      "function currentRichBlockquote"
    ],
    "app.js UX contract"
  );

  console.log("UX audit OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
