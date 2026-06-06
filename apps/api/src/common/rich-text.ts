const allowedTags = new Set(["a", "b", "blockquote", "br", "div", "em", "i", "li", "ol", "p", "s", "strong", "ul"]);

function safeHref(value = "") {
  const href = value.trim();
  if (!/^https?:\/\//i.test(href)) return "";
  return href.replace(/"/g, "&quot;");
}

export function sanitizeRichText(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (tag, rawName, attrs = "") => {
      const name = String(rawName || "").toLowerCase();
      if (!allowedTags.has(name)) return "";
      const closing = /^<\//.test(tag);
      if (closing) return name === "br" ? "" : `</${name}>`;
      if (name === "br") return "<br>";
      if (name === "a") {
        const href = safeHref(String(attrs).match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || "");
        return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : "";
      }
      if (name === "div") return /class\s*=\s*["']rich-content["']/i.test(attrs) ? '<div class="rich-content">' : "<div>";
      return `<${name}>`;
    })
    .replace(/<(p|blockquote|li)>\s*<\/\1>/gi, "")
    .replace(new RegExp(`(?:\\s*<br>\\s*){4,}`, "gi"), "<br><br><br>")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function richTextLength(value?: string) {
  return sanitizeRichText(value).length;
}

export function stripRichText(value?: string) {
  return sanitizeRichText(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|blockquote|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function richPlainTextLength(value?: string) {
  return stripRichText(value).length;
}
