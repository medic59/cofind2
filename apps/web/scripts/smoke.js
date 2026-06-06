const WEB_BASE = process.env.WEB_BASE || "http://localhost:3000";
const API_BASE = process.env.API_BASE || "http://localhost:4000/api/v1";
const WEB_ORIGIN = new URL(WEB_BASE).origin;

async function text(path) {
  const response = await fetch(`${WEB_BASE}${path}`);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${body.slice(0, 160)}`);
  }
  return body;
}

async function request(path, options = {}) {
  const response = await fetch(`${WEB_BASE}${path}`, options);
  const body = options.method === "HEAD" ? "" : await response.text();
  return { response, body };
}

async function json(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${body.slice(0, 160)}`);
  }
  return JSON.parse(body);
}

function assertIncludes(source, needles, label) {
  const missing = needles.filter((needle) => !source.includes(needle));
  if (missing.length) {
    throw new Error(`${label} is missing: ${missing.join(", ")}`);
  }
}

async function main() {
  const html = await text("/");
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) {
    throw new Error(`index.html has duplicate ids: ${duplicateIds.join(", ")}`);
  }
  if (html.includes('href="./styles.css"') || html.includes('src="./app.js"')) {
    throw new Error("index.html must use root-relative /styles.css and /app.js so refresh works on nested routes");
  }
  assertIncludes(
    html,
    [
      'href="/styles.css"',
      'src="/app.js"',
      'href="/favicon.svg"',
      'name="theme-color"',
      'id="view-home"',
      'id="view-feed"',
      'id="view-listing"',
      'id="view-new-listing"',
      'id="view-me"',
      'id="view-chat"',
      'id="view-admin"',
      'id="admin-role-note"',
      'id="view-help"',
      'id="view-rules"',
      'id="view-privacy"',
      'id="view-contacts"',
      'name="robots"',
      'rel="canonical"',
      'http-equiv="Content-Security-Policy"',
      'property="og:url"',
      'name="cofind-api-base"',
      'class="skip-link"',
      'id="main-content"',
      'id="view-subscription"',
      'id="header-subscription-button"',
      'data-paid-feature',
      'id="home-live-listings"',
      'id="home-live-chat"',
      'id="home-recent-listings"',
      'id="clear-recent-listings"',
      'data-catalog-tag="slow burn"',
      'id="save-feed-filters"',
      'id="reset-feed-filters"',
      'id="feed-filter-status"',
      'id="feed-active-filters"',
      'id="listing-list" aria-live="polite"',
      'id="feed-pagination"',
      'id="listing-detail-stats"',
      'id="listing-related-list"',
      'id="fill-response-template"',
      'id="listing-response-preview"',
      'id="listing-response-counter"',
      'id="listing-response-submit"',
      'id="copy-listing-link"',
      'id="copy-profile-link"',
      'id="message-profile-author"',
      'id="block-profile-author"',
      'id="report-profile-author"',
      'id="listing-form"',
      'id="listing-draft-status"',
      'id="listing-form-preview"',
      'id="listing-title-counter"',
      'id="listing-body-counter"',
      'id="listing-form-note"',
      'id="listing-submit"',
      'id="chat-form"',
      'id="chat-rooms"',
      'id="copy-chat-room-link"',
      'id="chat-search"',
      'id="clear-chat-search"',
      'id="chat-search-status"',
      'id="chat-room-note"',
      'id="load-older-chat"',
      'id="chat-history-status"',
      'data-chat-room="partners"',
      'id="chat-counter"',
      'id="chat-composer-note"',
      'id="chat-submit"',
      'chat-send-button',
      'id="header-inbox-button"',
      'id="header-notification-badge"',
      'id="inbox-summary"',
      'id="inbox-tabs"',
      'data-inbox-filter="new"',
      'id="inbox-refresh"',
      'id="inbox-search"',
      'id="inbox-sort"',
      'id="inbox-list-count"',
      'id="copy-private-link"',
      'id="private-search"',
      'id="clear-private-search"',
      'id="private-search-status"',
      'id="load-older-private"',
      'id="private-history-status"',
      'id="private-counter"',
      'id="private-rich-preview"',
      'id="private-submit"',
      'id="profile-avatar-preview"',
      'id="profile-avatar-preset"',
      'id="profile-avatar-file"',
      'id="profile-avatar-clear"',
      'id="profile-cover-preview"',
      'id="profile-cover-url"',
      'id="profile-cover-file"',
      'id="profile-cover-clear"',
      'id="profile-literacy-level"',
      'id="profile-post-length"',
      'id="profile-communication"',
      'id="profile-show-last-seen"',
      'id="profile-allow-messages"',
      'id="password-form"',
      'id="current-password"',
      'id="new-password"',
      'id="password-submit"',
      'id="download-my-data"',
      'id="deactivate-password"',
      'id="deactivate-account"',
      'id="profile-readiness-list"',
      'id="profile-readiness-note"',
      'id="account-role-panel"',
      'id="account-role-cards"',
      'data-owner-admin-feature',
      'id="open-my-public-profile"',
      'id="copy-my-profile-link"',
      'id="my-listing-tabs"',
      'data-my-listing-filter="PUBLISHED"',
      'id="liked-listings"',
      'id="refresh-liked-listings"',
      'id="notification-tabs"',
      'data-notification-filter="unread"',
      'id="suggestion-title-counter"',
      'id="suggestion-description-counter"',
      'id="suggestion-submit"',
      'id="my-suggestions-count"',
      'id="my-suggestions-search"',
      'id="my-suggestions-status"',
      'id="report-comment-counter"',
      'id="report-submit"',
      'id="my-reports-count"',
      'id="my-reports-search"',
      'id="my-reports-status"',
      'placeholder="id заявки, профиля или сообщения"',
      'data-auth-panel="login"',
      'data-auth-panel="reset"',
      'data-auth-mode="register"',
      'data-auth-mode="reset"',
      'autocomplete="current-password"',
      'autocomplete="new-password"',
      'pattern="[A-Za-z0-9_-]+"',
      'maxlength="160"',
      'id="reset-request-form"',
      'id="reset-confirm-form"',
      'id="reset-token"',
      'id="background-image-file"',
      'id="clear-background"',
      'id="cancel-subscription"',
      'id="payment-list-count"',
      'id="payment-search"',
      'id="payment-status-filter"',
      'id="drawing-preview"',
      'id="drawing-preview-image"',
      'decoding="async"',
      'id="remove-drawing"',
      'id="my-listings-count"',
      'id="my-listings-search"',
      'id="my-listings-sort"',
      'id="liked-listings-count"',
      'id="liked-listings-search"',
      'id="liked-listings-sort"',
      'id="block-list-count"',
      'id="block-list-search"',
      'id="profile-social-website"',
      'id="profile-social-telegram"',
      'id="profile-social-discord"',
      'id="public-profile-socials"',
      'id="public-profile-format"',
      'id="public-profile-listings-count"',
      'id="public-profile-listing-search"',
      'id="public-profile-listing-sort"',
      'id="public-profile-listings-pagination"',
      'id="admin-queue"',
      'id="admin-settings-section"',
      'id="admin-search-section"',
      'id="admin-owner-tools"',
      'id="admin-monetization-enabled"',
      'id="admin-settings-save"',
      'id="admin-queue-count"',
      'id="admin-queue-search"',
      'id="admin-queue-kind"',
      'id="admin-queue-status"',
      'id="admin-users-section"',
      'id="admin-catalog-section"',
      'id="admin-plans-section"',
      'id="admin-ads-section"',
      'id="admin-finance-section"',
      'id="admin-seo-section"',
      'id="admin-audit-section"',
      'id="admin-menu"',
      'data-admin-tab="overview"',
      'data-admin-panel="overview"',
      'data-admin-tab="users"',
      'data-admin-panel="users"',
      'pattern="[a-z0-9][a-z0-9-]*"',
      'id="admin-users-count"',
      'id="admin-users-search"',
      'id="admin-users-role"',
      'id="admin-users-status"',
      'id="admin-tags-count"',
      'id="admin-tags-search"',
      'id="admin-tags-status-filter"',
      'id="admin-genres-count"',
      'id="admin-genres-search"',
      'id="admin-genres-status-filter"',
      'id="admin-fandoms-count"',
      'id="admin-fandoms-search"',
      'id="admin-fandoms-status-filter"',
      'id="admin-characters-count"',
      'id="admin-characters-search"',
      'id="admin-characters-status-filter"',
      'id="admin-plans-count"',
      'id="admin-plans-search"',
      'id="admin-plans-status-filter"',
      'id="admin-ad-impression-limit"',
      'id="admin-ad-starts-at"',
      'id="admin-ad-ends-at"',
      'id="admin-ad-hide-premium"',
      'id="admin-ads-count"',
      'id="admin-ads-search"',
      'id="admin-ads-position-filter"',
      'id="admin-ads-status-filter"',
      'id="admin-seo-count"',
      'id="admin-seo-search"',
      'id="admin-seo-index-filter"',
      'id="admin-finance-count"',
      'id="admin-finance-search"',
      'id="admin-finance-kind"',
      'id="admin-finance-status"',
      'id="admin-audit-count"',
      'id="admin-audit-search"',
      'id="admin-audit-entity"'
    ],
    "index.html"
  );
  const toolbarPlaceholders = [...html.matchAll(/class="rich-toolbar" data-editor-target=/g)].length;
  if (toolbarPlaceholders !== 4 || html.includes("data-rich-action")) {
    throw new Error(`index.html expected 4 empty rich editor toolbar placeholders, found ${toolbarPlaceholders}`);
  }
  assertIncludes(html, ["data-view-link=\"admin\"", "data-staff-feature"], "index.html staff-only admin entry");
  if (
    /id="listing-related-(tag|world)"[^>]*data-view-link=/.test(html) ||
    /data-view-link="feed"[^>]*id="listing-related-(tag|world)"/.test(html)
  ) {
    throw new Error("listing related links must keep their query hrefs without the generic data-view-link handler");
  }

  const css = await text("/styles.css");
  const definedCssVars = new Set([...css.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map((match) => match[1]));
  const missingCssVars = [...css.matchAll(/var\(--([a-zA-Z0-9-]+)([^)]*)\)/g)]
    .filter((match) => !definedCssVars.has(match[1]) && !match[2].includes(","))
    .map((match) => `--${match[1]}`);
  if (missingCssVars.length) {
    throw new Error(`styles.css uses undefined custom properties: ${[...new Set(missingCssVars)].join(", ")}`);
  }
  assertIncludes(
    css,
    ["@media (max-width: 920px)", "@media (max-width: 720px)", "@media (max-width: 560px)", "--accent-strong", "--radius-sm", ".skip-link", ".topbar", ".listing-card", ".listing-card h2 a", ".home-live-grid", ".home-chat-message", ".home-chat-drawing", ".detail-stats", ".related-listings", ".listing-form-preview", ".response-head", ".inbox-summary", ".inbox-tabs", ".listing-tabs", ".notification-tabs", ".notification-badge", ".feed-pagination", ".active-filters", ".avatar-editor", ".cover-editor", ".cover-preview", ".profile-socials", ".profile-social-editor", ".profile-format-grid", ".profile-listing-tools", ".preference-toggles", ".danger-zone", ".danger-button", ".role-cards", ".role-card", ".readiness-list", ".rich-toolbar", ".rich-editor-shell", ".rich-editor", ".rich-emoji-picker", ".rich-content", ".chat-search", ".chat-room-note", ".chat-history-actions", ".private-history-actions", ".private-search", ".char-counter", ".api-status.is-partial", "button:disabled", "button:focus-visible", "overflow-wrap: anywhere", "min-height: 44px", "min-width: 680px", ".appearance-grid > *", "width: min(100%, 620px)", "aspect-ratio: 16 / 9"],
    "styles.css"
  );

  const app = await text("/app.js");
  assertIncludes(
    app,
    ["const apiBaseMeta", "cofind-api-base", "const API_BASE", "cofindRefreshToken", "async function refreshAuthSession", "function normalizeListing", "async function apiFetch", "connectChatSocket", "hydrateFromApi();", "featureFlags", "monetizationEnabled", "function applyFeatureFlags", "/settings", "/admin/settings", "admin-monetization-enabled", "function renderAdminSettings", "function updateChatComposerState", "function updatePrivateComposerState", "function setLinkRel", "function setJsonLd", "application/ld+json", "function clipText", "function seoFallbackForView", "function updateStructuredData", "SearchAction", "ItemList", "CreativeWork", "Person", "sameAs", "knowsAbout", "InteractionCounter", "function viewPath", "function currentViewName", "function isIndexableView", "function openAppPath", "function openPathRoute", "function openCurrentRoute", "function copyToClipboard", "function downloadJsonFile", "/me/export", "cofind-data-", "Экспорт данных подготовлен", "function richTextToHtml", "function updateRichPreview", "data-rich-command", "help: \"/help\"", "rules: \"/rules\"", "privacy: \"/privacy\"", "contacts: \"/contacts\"", "function activityLabel", "function compactNumber", "lastSeenAt", "последняя активность", "showLastSeen", "allowProfileMessages", "ЛС закрыты", "function profileSocialUrls", "function renderProfileSocials", "socialLinks", "socialWebsite", "socialTelegram", "socialDiscord", "profile-social-website", "profile.stats", "function applyRelatedListingFilter", "function listingSimilarityScore", "function renderRelatedListings", "data-open-related-listing", "function renderLikedListings", "likedListingsCache", "liked-listings-search", "liked-listings-sort", "liked-listings-count", "/me/liked-listings", "function renderProfileReadiness", "data-readiness-action", "% готовности", "hasSocialContact", "Обложка", "Контакты", "open-my-public-profile", "copy-my-profile-link", "Ссылка на ваш профиль скопирована", "function renderMyListingTabs", "activeMyListingsFilter", "my-listings-search", "my-listings-sort", "my-listings-count", "statusRank", "data-my-listings-empty-action", "data-delete-my-listing", "Заявка удалена", "data-admin-user-action=\"restore\"", "Пользователь восстановлен", "restore-listing", "Заявка восстановлена в черновики", "function renderNotificationTabs", "activeNotificationFilter", "data-notification-filter", "data-clear-chat-search", "chat-search-status", "function chatUrl", "function applyChatRoomFromQuery", "const chatRoomKey", "const chatRooms", "function chatRoomMarker", "function wireChatRooms", "copy-chat-room-link", "Ссылка на ${room.label} скопирована", "data-chat-room-empty", "chatPageSize", "chatHasMore", "function loadOlderChatMessages", "chat-history-status", "activePrivateMessages", "private-search-status", "data-clear-private-search", "Ссылка на диалог скопирована", "function uploadImageDataUrl", "/uploads/images", "Аватар загружен в хранилище", "Рисунок загружен в хранилище", "Фон загружен в хранилище", "Обложка загружена в хранилище", "function applyBackgroundPreview", "function setCoverElement", "#clear-background", "Фон убран", "\"background\"", "\"cover\"", "coverImageUrl", "profile.coverImageUrl", "outboundDrawing", "profile-literacy-level", "profile-post-length", "profile-communication", "communicationPreferences", "preferredPostLength", "literacyLevel", "data-like-feed", "const listingDraftKey", "function saveListingDraft", "function restoreListingDraft", "localStorage.setItem(listingDraftKey", "function clearListingDraft", "const recentListingsKey", "function rememberRecentListing", "function renderRecentListings", "localStorage.setItem(recentListingsKey", "История просмотра очищена", "const feedFiltersKey", "function feedStatePayload", "function persistFeedFilters", "function restoreFeedFilters", "function resetFeedFilters", "function renderFeedFilterChips", "function removeFeedFilter", "data-remove-feed-filter", "data-empty-feed-action", "localStorage.setItem(feedFiltersKey", "Фильтры ленты сохранены", "function renderInboxTabs", "function setInboxFilter", "activeInboxFilter", "conversation\", conversationId", "tab\", filter", "function updateListingPreview", "function selectedCatalogNames", "function updateListingFormState", "Заголовок должен быть от 6 до 140 символов", "Описание должно быть от 20 до 4000 символов", "function updateListingResponseState", "Отклик должен быть от 10 до 4000 символов", "function updateSuggestionFormState", "Предложение готово к отправке", "function updateReportFormState", "function applyReportStateFromQuery", "Жалоба готова к отправке", "function notificationActionLabel", "function avatarMarkup", "function setAvatarElement", "authButton.dataset.viewLink = isLoggedIn ? \"me\" : \"auth\"", "Открыть личный кабинет", "headerInboxUnreadCount", "function updateHeaderNotificationBadge", "+ headerInboxUnreadCount", "headerInboxButton?.classList.toggle", "function openAuthForCurrentView", "openAuthForCurrentView(\"Для оформления подписки сначала войдите\", \"subscription\")", "openAuthForCurrentView(\"Чтобы отправить отклик, войдите в аккаунт\", \"listing\")", "function listingHref", "href=\"${escapeHtml(path)}\"", "function inboxUrl", "function applyInboxStateFromQuery", "authorUsername", "href=\"/profile/${encodeURIComponent(item.authorUsername)}\"", "data-open-profile", "openProfile(profileLink.dataset.openProfile)", "message-profile-author", "/conversations/direct", "block-profile-author", "report-profile-author", "currentPublicProfile?.user?.id", "data-unblock-user", "function feedControls", "function feedUrlForPage", "function syncFeedUrl", "function applyFeedStateFromQuery", "function setFeedSort", "function renderFeedPagination", "function goToFeedPage", "history.pushState", "popstate", "canonical", "seo.canonical || currentUrl", "og:url", "og:image", "prev", "next", "robots", "noindex,nofollow", "avatarUrl", "profile.avatarUrl", "feedPageSize", "deepLinkRoute", "authRequiredViews", "pendingViewAfterAuth", "skipAuthGuard", "chat-counter", "chat-submit", "private-counter", "private-submit", "data-auth-mode", "listing-response-status", "fill-response-template", "copy-listing-link", "copy-profile-link", "listing-related-tag", "listing-related-world", "Открыть диалоги", "notifications/${notification.dataset.notificationId}/read", "section === \"me\" && parts[1] === \"subscription\"", "setView(\"listing\", { url: `/listing/${encodeURIComponent(listing.id)}` })", "me: \"me\"", "/me/subscription/cancel", "Premium отключен", "Заявка закрыта для новых откликов", "quickReactionEmojis", "!quickReactionEmojis.includes(emoji)", "chatSocket?.readyState === WebSocket.OPEN && !outboundDrawing", "drawingUrl: outboundDrawing || undefined", "chat.error", "result.liked ? 1 : -1", "result.reacted ? 1 : -1", "pendingListingLikes", "pendingMessageReactions", "function setDrawingPreview", "Лайк снят", "function toDatetimeLocal", "function fromDatetimeLocal"],
    "app.js"
  );
  assertIncludes(
    app,
    ["currentPublicProfileListings", "currentPublicProfileListingsTotal", "currentPublicProfileListingsTotalPages", "publicProfileListingsQuery", "publicProfileListingsSort", "publicProfileListingsTimer", "listingsPagination", "function profileUrl", "listingsPage", "params.set(\"q\", query)", "params.set(\"sort\", sort)", "pageSize: String(publicProfileListingsPageSize)", "publicProfileListingsPage", "publicProfileListingsPageSize", "function renderPublicProfileListings", "public-profile-listing-search", "public-profile-listing-sort", "public-profile-listings-count", "public-profile-listings-pagination", "data-profile-listings-page", "function renderProfileFormat", "public-profile-format"],
    "app.js profile listing tools"
  );
  assertIncludes(
    app,
    ["const privatePageSize", "privateHasMore", "privateLoadingOlder", "function updatePrivateHistoryControls", "function loadOlderPrivateMessages", "load-older-private", "private-history-status", "messages?cursor=${encodeURIComponent(cursor)}"],
    "app.js private message history pagination"
  );
  assertIncludes(
    app,
    ["function renderCatalogCloud", "data-catalog-tag", "escapeHtml(tag.name)"],
    "app.js catalog cloud"
  );
  assertIncludes(
    app,
    ["function renderAccountRolePanel", "function accountRoleLabel", "function isOwnerAdmin", "function updateAdminRoleNote", "data-role-action", "data-owner-admin-feature"],
    "app.js role-aware cabinet"
  );
  assertIncludes(
    app,
    ["function execRichCommand", "function normalizeRichUrl", "URL ссылки", "document.execCommand(\"createLink\"", "document.execCommand(\"removeFormat\"", "function autoGrowRichEditor", "function saveRichSelection", "function currentRichBlockquote", "function unwrapRichBlockquote", "function exitRichBlockquote", "function applyRichListCommand", "function applyRichQuoteCommand", "function applyRichLinkCommand"],
    "app.js rich editor ux"
  );
  assertIncludes(
    app,
    ["function initializeRichEditors", "contentEditable", "data-rich-command", "document.execCommand", "function sanitizeRichHtml", "function richValueToEditorHtml", "function syncRichEditorFromTextarea", "richEditorEmojis"],
    "app.js native wysiwyg editor"
  );
  assertIncludes(
    app,
    ["function richPlainLength", "function richStoredLength", "function richWithinStoredLimit", "Форматирования слишком много"],
    "app.js rich editor length validation"
  );
  assertIncludes(
    app,
    ["const uploadImageTypes", "const uploadImageLimits", "function validateImageFile", "function validateImageDataUrl", "function readImageFileDataUrl", "imageDataUrlSize", "uploadSizeLabel"],
    "app.js image upload validation"
  );
  assertIncludes(
    app,
    ["uploadImageMaxDimensions", "uploadImageSourceLimit", "function optimizeImageDataUrl", "function prepareImageDataUrl", "imageSmoothingQuality", "canvas.toDataURL(\"image/webp\""],
    "app.js client image optimization"
  );
  assertIncludes(
    app,
    ["function safeHttpUrl", "function safeImageUrl", "function safeAvatarUrl", "safeImageUrl(imageUrl)", "safeHttpUrl(placement.clickUrl)"],
    "app.js safe media urls"
  );
  assertIncludes(
    app,
    ["function sanitizeAdHtml", "safeHttpUrl(element.getAttribute(\"href\")", "safeHttpUrl(element.getAttribute(\"src\")", "sanitizeAdHtml(placement.htmlCode)"],
    "app.js safe ad html"
  );
  if (app.includes('selected || "жирный текст"') || app.includes('selected || "курсив"') || app.includes('selected || "пункт списка"')) {
    throw new Error("app.js rich editor must not insert placeholder formatting words into empty selections");
  }
  if (!app.includes("const pendingKey = String(message.id)")) {
    throw new Error("app.js must lock chat reactions per message while a reaction request is pending");
  }
  assertIncludes(
    app,
    ["function setFeedBusy", "aria-busy", "Лента обновляется", "API ленты недоступен"],
    "app.js feed loading state"
  );
  assertIncludes(
    app,
    ["function shouldUseNativeNavigation", "event.metaKey", "event.ctrlKey", "event.shiftKey", "shouldUseNativeNavigation(event, link)", "shouldUseNativeNavigation(event, openButton)", "shouldUseNativeNavigation(event, profileLink)"],
    "app.js native link navigation"
  );
  assertIncludes(
    app,
    ["let pendingPathAfterAuth", "function completeAuthRedirect", "pendingPathAfterAuth = options.url || viewPath(normalized)", "setView(\"inbox\", { updateHistory, url: routeUrl })", "completeAuthRedirect(\"me\")"],
    "app.js auth redirect paths"
  );
  assertIncludes(
    app,
    ["function ensureButtonTypes", "button:not([type])", "form[method=\"dialog\"]", "new MutationObserver"],
    "app.js button type guard"
  );
  if (app.includes("Действие сохранено в прототипе")) {
    throw new Error("app.js must not hide missing form handlers behind prototype fallback submit");
  }
  const formIds = [...html.matchAll(/<form[^>]+id="([^"]+)"/g)].map((match) => match[1]);
  const handledForms = formIds.filter((id) => app.includes(`querySelector("#${id}")?.addEventListener("submit"`));
  if (handledForms.length !== formIds.length) {
    const missing = formIds.filter((id) => !app.includes(`querySelector("#${id}")?.addEventListener("submit"`));
    throw new Error(`index.html has forms without submit handlers: ${missing.join(", ")}`);
  }
  assertIncludes(
    app,
    ["tagLink.href = tags[0] ? `/feed?q=${encodeURIComponent(tags[0])}`", "worldLink.href = params.toString() ? `/feed?${params.toString()}`", "setView(\"feed\", { url: feedUrlForPage(1) })"],
    "app.js related feed hrefs"
  );
  assertIncludes(
    app,
    ["aria-current", "link.setAttribute(\"aria-current\", \"page\")", "link.removeAttribute(\"aria-current\")"],
    "app.js nav accessibility"
  );
  assertIncludes(
    app,
    ["inbox-search", "inbox-sort", "inbox-list-count", "baseRows", "row.html"],
    "app.js inbox tools"
  );
  assertIncludes(
    app,
    ["const responseText = stripRichText(response.message || \"\")", "const previewText = stripRichText(message?.text || \"\")", "stripRichText(message.quote || \"\")"],
    "app.js rich text search previews"
  );
  assertIncludes(
    app,
    ["blocksCache", "block-list-search", "block-list-count", "function renderBlocks"],
    "app.js block list tools"
  );
  assertIncludes(
    app,
    ["mySuggestionsCache", "myReportsCache", "my-suggestions-search", "my-suggestions-status", "my-reports-search", "my-reports-status"],
    "app.js moderation history tools"
  );
  assertIncludes(
    app,
    ["paymentsCache", "payment-search", "payment-status-filter", "payment-list-count"],
    "app.js payment tools"
  );
  assertIncludes(
    app,
    ["adminQueueCache", "admin-queue-search", "admin-queue-kind", "admin-queue-status", "admin-queue-count"],
    "app.js admin queue tools"
  );
  assertIncludes(
    app,
    ["activeAdminTab", "adminOwnerTabs", "adminLoadedTabs", "function adminUrl", "function applyAdminStateFromQuery", "function normalizeAdminTab", "function applyAdminTab", "function loadAdminTab", "data-admin-panel", "is-admin-panel-hidden", "data-admin-tab"],
    "app.js admin tabs"
  );
  assertIncludes(
    app,
    ["adminUsersCache", "admin-users-search", "admin-users-role", "admin-users-status", "admin-users-count"],
    "app.js admin users tools"
  );
  assertIncludes(
    app,
    ["adminCatalogCache", "function renderAdminCatalogList", "admin-tags-search", "admin-genres-search", "admin-fandoms-search", "admin-characters-search", "admin-tags-count", "admin-characters-status-filter"],
    "app.js admin catalog tools"
  );
  assertIncludes(
    app,
    ["adminPlansCache", "adminAdsCache", "adminSeoCache", "admin-plans-search", "admin-ads-position-filter", "admin-seo-index-filter"],
    "app.js admin monetization seo tools"
  );
  assertIncludes(
    app,
    ["adminFinanceCache", "admin-finance-search", "admin-finance-kind", "admin-finance-status", "admin-finance-count"],
    "app.js admin finance tools"
  );
  assertIncludes(
    app,
    ["adminAuditCache", "admin-audit-search", "admin-audit-entity", "admin-audit-count"],
    "app.js admin audit tools"
  );

  const robots = await text("/robots.txt");
  assertIncludes(robots, [`Sitemap: ${WEB_ORIGIN}/sitemap.xml`], "robots.txt");

  const favicon = await text("/favicon.svg");
  assertIncludes(favicon, ["<svg", "Cofind 2", "#2FBF9F", "#6F5CFF"], "favicon.svg");

  const sitemap = await text("/sitemap.xml");
  assertIncludes(sitemap, [`${WEB_ORIGIN}/`, `${WEB_ORIGIN}/feed`, `${WEB_ORIGIN}/feed?page=2`, `${WEB_ORIGIN}/chat`, `${WEB_ORIGIN}/help`, `${WEB_ORIGIN}/rules`, `${WEB_ORIGIN}/privacy`, `${WEB_ORIGIN}/contacts`], "sitemap.xml");
  if (sitemap.includes("/me/")) throw new Error("sitemap.xml must not include personal noindex pages");

  const redirects = await text("/_redirects");
  assertIncludes(redirects, ["/* /index.html 200"], "_redirects");

  const head = await request("/", { method: "HEAD" });
  if (!head.response.ok) throw new Error(`HEAD / failed: ${head.response.status}`);
  if (!head.response.headers.get("x-content-type-options")) throw new Error("Expected security headers on HEAD /");
  if (!head.response.headers.get("content-security-policy")) throw new Error("Expected CSP header on HEAD /");

  const routeFallback = await request("/listing/demo-route");
  if (!routeFallback.response.ok || !routeFallback.body.includes('id="view-listing"')) {
    throw new Error("Expected SPA route fallback for /listing/demo-route");
  }

  const missingAsset = await request("/missing-smoke-asset.css");
  if (missingAsset.response.status !== 404) {
    throw new Error(`Expected missing asset to return 404, got ${missingAsset.response.status}`);
  }

  const health = await json(`${API_BASE}/health`);
  if (!health.ok) throw new Error("API health did not return ok=true");

  const listings = await json(`${API_BASE}/search/listings`);
  const hits = listings.hits || listings;
  if (!Array.isArray(hits)) throw new Error("Expected search/listings to return an array or hits array");
  const pagedListings = await json(`${API_BASE}/search/listings?page=1&pageSize=2`);
  if (!pagedListings.pagination || pagedListings.pagination.pageSize !== 2) {
    throw new Error("Expected search/listings pagination metadata");
  }

  console.log(`Web smoke OK: ${WEB_BASE} -> ${API_BASE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
