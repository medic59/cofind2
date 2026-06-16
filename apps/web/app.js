const views = [...document.querySelectorAll(".view")];
const links = [...document.querySelectorAll("[data-view-link]")];
const mainNav = document.querySelector("#main-nav");
const toast = document.querySelector("#toast");
const apiStatus = document.querySelector("#api-status");
const wsStatus = document.querySelector("#ws-status");
const authButton = document.querySelector("#auth-button");
const headerInboxButton = document.querySelector("#header-inbox-button");
const headerNotificationBadge = document.querySelector("#header-notification-badge");
const logoutButton = document.querySelector("#logout-button");
const topbar = document.querySelector(".topbar");
const mobileMenuToggle = document.querySelector("#mobile-menu-toggle");
const mobileMenu = document.querySelector("#topbar-menu");
const apiBaseMeta = document.querySelector('meta[name="cofind-api-base"]')?.content?.trim();
function isLocalApiBase(value = "") {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/api\/v1\/?$/i.test(value.trim());
}

function resolveApiBase() {
  const productionHost = location.hostname && !["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const stored = localStorage.getItem("cofindApiBase")?.trim();
  if (productionHost) {
    if (stored) localStorage.removeItem("cofindApiBase");
    return apiBaseMeta || `${location.origin}/api/v1`;
  }
  if (stored && /^https?:\/\//i.test(stored)) return stored;
  if (stored) localStorage.removeItem("cofindApiBase");
  return apiBaseMeta || "http://localhost:4000/api/v1";
}

const API_BASE = resolveApiBase();
const WS_BASE = API_BASE.replace(/^http/i, "ws").replace(/\/api\/v1\/?$/, "/ws/chat");

// First-party, cookieless analytics beacon. Same-origin POST to the API — no
// cookies, no third-party scripts, nothing that needs a consent banner or a CSP
// change. Fire-and-forget; analytics must never break the app or block render.
let lastTrackedPath = null;
let analyticsReferrerSent = false;
function sendAnalytics(payload) {
  try {
    const url = `${API_BASE}/analytics/collect`;
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* ignore — analytics is best-effort */
  }
}
function trackPageview() {
  const path = location.pathname || "/";
  if (path === lastTrackedPath) return; // dedupe: one count per screen
  lastTrackedPath = path;
  const payload = { type: "pageview", path };
  if (!analyticsReferrerSent) {
    analyticsReferrerSent = true;
    if (document.referrer) payload.referrer = document.referrer; // entry referrer, once per session
  }
  sendAnalytics(payload);
}
function trackEvent(name) {
  sendAnalytics({ type: name, path: location.pathname || "/" });
}
const uploadImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const uploadImageLimits = {
  avatar: 128 * 1024,
  background: 256 * 1024,
  cover: 256 * 1024,
  drawing: 256 * 1024
};
const uploadImageSourceLimit = 8 * 1024 * 1024;
const uploadImageMaxDimensions = {
  avatar: { width: 512, height: 512, quality: 0.82 },
  background: { width: 1920, height: 1080, quality: 0.78 },
  cover: { width: 1600, height: 900, quality: 0.8 },
  drawing: { width: 960, height: 720, quality: 0.86 }
};
const uploadImageLabels = {
  avatar: "Аватар",
  background: "Фон",
  cover: "Обложка",
  drawing: "Рисунок"
};
let featureFlags = {
  monetizationEnabled: false,
  aiEnabled: false
};

function ensureButtonTypes(root = document) {
  const buttons = root.matches?.("button:not([type])")
    ? [root]
    : [...root.querySelectorAll?.("button:not([type])") || []];
  buttons.forEach((button) => {
    if (button.closest('form[method="dialog"]')) return;
    button.type = "button";
  });
}

ensureButtonTypes();
new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) ensureButtonTypes(node);
    });
  });
}).observe(document.body, { childList: true, subtree: true });

function readStoredJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

let authSession = {
  accessToken: localStorage.getItem("cofindAccessToken"),
  refreshToken: localStorage.getItem("cofindRefreshToken"),
  user: readStoredJson("cofindUser")
};
let authSessionVersion = 0;
// Header auth state is "pending" until the cookie session is verified, so the
// profile button can show a skeleton instead of flashing the wrong label.
let authResolved = false;

function hasAuthHintCookie() {
  return /(?:^|;\s*)cofind_auth=1(?:;|$)/.test(document.cookie);
}

function clearAuthHintCookie() {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `cofind_auth=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function applyAuthStateAttr() {
  const el = document.documentElement;
  const pendingUser = !authResolved && hasAuthHintCookie();
  el.dataset.authState = isAuthenticated() || pendingUser ? "user" : "guest";
  el.classList.toggle("auth-resolved", authResolved);
}

function reconcileBootAuthState() {
  if (!hasAuthHintCookie()) {
    // No live server session: discard any stale client tokens so the header
    // never shows logged-in chrome (ЛК / Сообщения / Выйти) to a guest.
    if (authSession.accessToken || authSession.refreshToken || authSession.user) {
      authSession = { accessToken: null, refreshToken: null, user: null };
      try {
        localStorage.removeItem("cofindAccessToken");
        localStorage.removeItem("cofindRefreshToken");
        localStorage.removeItem("cofindUser");
      } catch {}
    }
    authResolved = true;
  } else if (isAuthenticated()) {
    // Cached credentials + live session hint: render the user header immediately;
    // background verification (loadMe) still runs and can sign out on failure.
    authResolved = true;
  }
  // else: hint cookie present but no cached creds -> stay pending (skeleton)
  // until bootstrapAuthFromCookie() resolves.
}

let listings = [
  {
    id: 1,
    type: "COAUTHOR_SEARCH",
    title: "Камерный детектив в магической академии",
    author: "MiraInk",
    rating: "MATURE",
    age: "2 дня назад",
    body: "Ориджинал с интригой, закрытым кругом подозреваемых и персонажной драмой без гонки по темпу.",
    tags: ["детектив", "магическая академия", "slow burn", "ориджинал"],
    likes: 128,
    responses: 4,
    open: true,
    created: 9
  },
  {
    id: 2,
    type: "ROLEPLAY_SEARCH",
    title: "Ищу соигрока для urban fantasy и переписок персонажей",
    author: "Arlen",
    rating: "TEEN",
    age: "сегодня",
    body: "Люблю короткие сцены, атмосферные диалоги, цитирование и постепенное раскрытие отношений.",
    tags: ["urban fantasy", "OC", "dialogue", "found family"],
    likes: 86,
    responses: 0,
    open: true,
    created: 18
  },
  {
    id: 3,
    type: "BETA_READER_SEARCH",
    title: "Нужен бета-ридер для фанфика по космоопере",
    author: "Lysa",
    rating: "EVERYONE",
    age: "5 дней назад",
    body: "Проверка логики сцен, ритма и грамотности. Текст 45 тысяч знаков, дедлайн мягкий.",
    tags: ["beta", "space opera", "редактура", "приключения"],
    likes: 47,
    responses: 7,
    open: true,
    created: 4
  },
  {
    id: 4,
    type: "TEAM_SEARCH",
    title: "Собираем команду для интерактивного текстового проекта",
    author: "NovaVerse",
    rating: "TEEN",
    age: "1 неделю назад",
    body: "Нужны авторы веток, редактор и человек, который любит систематизировать персонажей и теги.",
    tags: ["team", "interactive fiction", "редактор", "проект"],
    likes: 112,
    responses: 11,
    open: false,
    created: 2
  },
  {
    id: 5,
    type: "ROLEPLAY_SEARCH",
    title: "Темное фэнтези 18+ с обязательной маркировкой триггеров",
    author: "Velvet",
    rating: "ADULT",
    age: "вчера",
    body: "Ищу партнера, который умеет заранее обсуждать границы, предупреждения и комфортный формат сцен.",
    tags: ["dark fantasy", "18+", "limits", "drama"],
    likes: 65,
    responses: 2,
    open: true,
    created: 13
  }
];

let messages = [];

let activeSort = "new";
let feedPage = 1;
const feedPageSize = 20;
let feedServerPagination = null;
let feedTotalPages = 1;
// True once the feed has real API data. Until then we keep the server-rendered
// (SSI) first-page cards instead of clobbering them with offline/mock content.
let feedApiLoaded = false;
let quotedMessage = null;
let eraserMode = false;
let drawingData = null;
let chatSocket = null;
const chatPageSize = 50;
let chatHasMore = false;
let chatLoadingOlder = false;
let chatAvailability = "loading";
let chatErrorCode = null; // e.g. CHAT_API_503 / CHAT_API_UNREACHABLE / API_UNREACHABLE
let chatRealtimeState = "connecting"; // "connecting" | "online" | "offline"
let chatRealtimeCode = null; // WebSocket close code (e.g. 1006) when offline
let chatRealtimeReady = true; // /health/ready realtime dependency
const pendingListingLikes = new Set();
const pendingMessageLikes = new Set();
const pendingMessageReactions = new Set();
const listingDraftKey = "cofindListingDraft";
const recentListingsKey = "cofindRecentListings";
const feedFiltersKey = "cofindFeedFilters";
const chatRoomKey = "cofindChatRoom";
let applyingRemotePreferences = false;
let savePreferencesTimer = null;
let feedSearchTimer = null;
let listingDraftTimer = null;
let restoringListingDraft = false;
let apiOnline = false;
let selectedListing = null;
let editingListingId = null;
let myListingsCache = [];
let likedListingsCache = [];
let activeMyListingsFilter = "all";
let inboxConversations = [];
let inboxPayload = { conversations: [], sentResponses: [], incomingResponses: [] };
let activePrivateConversationId = null;
let activePrivateMessages = [];
const privatePageSize = 50;
let privateHasMore = false;
let privateLoadingOlder = false;
let activeInboxFilter = "all";
let blocksCache = [];
let blocksLoaded = false;
let blocksLoadingPromise = null;
let recentListings = [];
let pendingViewAfterAuth = null;
let pendingPathAfterAuth = null;
const authRequiredViews = new Set(["me", "appearance", "inbox", "new-listing", "admin", "ai-partner"]);
let deepLinkRoute = null;
let currentProfileUsername = null;
let currentPublicProfile = null;
let currentPublicProfileListings = [];
let currentPublicProfileListingsTotal = 0;
let currentPublicProfileListingsTotalPages = 1;
let publicProfileListingsPage = 1;
let publicProfileListingsQuery = "";
let publicProfileListingsSort = "new";
const publicProfileListingsPageSize = 6;
let publicProfileListingsTimer = null;
let selectedAvatarUrl = "";
let selectedCoverUrl = "";
let latestNotifications = [];
let activeNotificationFilter = "all";
let mySuggestionsCache = [];
let myReportsCache = [];
let paymentsCache = [];
let adminQueueCache = { reports: [], suggestions: [], listings: [] };
let adminUsersCache = [];
let adminFinanceCache = { payments: [], subscriptions: [] };
let adminAuditCache = [];
let adminCatalogCache = { tags: [], genres: [], fandoms: [], characters: [] };
let adminPlansCache = [];
let adminAdsCache = [];
let adminSeoCache = [];
let activeAdminTab = "overview";
const adminOwnerTabs = new Set(["launch", "premium", "seo", "audit", "analytics"]);
const adminLoadedTabs = new Set();
let headerInboxUnreadCount = 0;
const chatRooms = [
  { slug: "general", label: "# общий", hint: "Здесь видны все сообщения." },
  { slug: "partners", label: "# поиск соигроков", hint: "Для поиска партнеров, темпа, формата и первых контактов." },
  { slug: "fandoms", label: "# фандомы", hint: "Для миров, канонов, персонажей и AU-идей." },
  { slug: "moderation", label: "# модерация", hint: "Для вопросов правил, жалоб и безопасности." }
];
let activeChatRoom = localStorage.getItem(chatRoomKey) || "general";
let catalogTags = [
  { slug: "slow-burn", name: "slow burn" },
  { slug: "oc", name: "OC" }
];
let catalogGenres = [];
let catalogFandoms = [];
let catalogCharacters = [];
let selectedListingTagSlugs = ["slow-burn", "oc"];
let selectedListingGenreSlugs = [];
let selectedListingFandomSlugs = [];
let selectedListingCharacterSlugs = [];
let adPlacements = [];
const defaultSeo = {
  home: {
    title: "Cofind 2 - поиск соавторов и ролевых партнеров",
    description: "Cofind 2 - творческая платформа для поиска соавторов, соигроков, фандомных партнеров и команд."
  },
  feed: {
    title: "Заявки - Cofind 2",
    description: "Лента творческих заявок Cofind 2: соавторы, соигроки, бета-ридеры и команды."
  },
  listing: {
    title: "Заявка - Cofind 2",
    description: "Детальная страница творческой заявки Cofind 2."
  },
  profile: {
    title: "Профиль автора - Cofind 2",
    description: "Публичный профиль автора Cofind 2 с заявками, стилем и темпом."
  },
  help: {
    title: "Помощь - Cofind 2",
    description: "Быстрый старт Cofind 2: как заполнить профиль, найти партнера, написать заявку и обратиться к модерации."
  },
  rules: {
    title: "Правила сообщества - Cofind 2",
    description: "Правила Cofind 2: уважение границ, маркировка рейтинга, запрет спама, травли и мошенничества."
  },
  privacy: {
    title: "Приватность - Cofind 2",
    description: "Как Cofind 2 хранит профиль, заявки, переписку, уведомления и настройки пользователя."
  },
  contacts: {
    title: "Контакты - Cofind 2",
    description: "Связь с поддержкой Cofind 2, модерацией и предложениями каталога."
  },
  chat: {
    title: "Общий чат - Cofind 2",
    description: "Общий чат Cofind 2: обсуждайте идеи и ищите партнёров по фандому, жанру и темпу в реальном времени."
  },
  suggestions: {
    title: "Предложения - Cofind 2",
    description: "Предложите новые теги, жанры, фандомы и персонажей в каталог Cofind 2."
  }
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function apiFailure(prefix, error) {
  return error?.message ? `${prefix}: ${error.message}` : prefix;
}

function setApiStatus(online, label = online ? "Сервис доступен" : "Сервис временно недоступен", state = online ? "online" : "offline") {
  apiOnline = online;
  if (!apiStatus) return;
  apiStatus.textContent = label;
  apiStatus.classList.toggle("is-online", state === "online");
  apiStatus.classList.toggle("is-partial", state === "partial");
  apiStatus.classList.toggle("is-offline", state === "offline");
}

// Human-readable chat/realtime diagnostic with a specific code instead of a
// generic "недоступно". Used by the status pill, composer note and chat box.
function chatDiagnostic() {
  if (chatAvailability === "unavailable") {
    return { ok: false, code: chatErrorCode, text: `Чат временно недоступен${chatErrorCode ? ` (${chatErrorCode})` : ""}. Попробуйте обновить страницу позже.` };
  }
  if (chatRealtimeState === "offline") {
    const reason = chatRealtimeReady ? "" : ", realtime-сервис недоступен";
    return { ok: false, code: chatRealtimeCode ? `WS_${chatRealtimeCode}` : "WS_OFFLINE", text: `Realtime офлайн${chatRealtimeCode ? ` (код ${chatRealtimeCode})` : ""}${reason}. Новые сообщения появятся после обновления страницы.` };
  }
  if (chatRealtimeState === "connecting") {
    return { ok: false, code: "WS_CONNECTING", text: "Realtime: подключение…" };
  }
  return { ok: true, code: null, text: "Realtime: онлайн" };
}

function setWsStatus() {
  updateChatComposerState();
  if (!wsStatus) return;
  const diag = chatDiagnostic();
  wsStatus.textContent = diag.text;
  wsStatus.classList.toggle("is-online", diag.ok);
  wsStatus.classList.toggle("is-offline", !diag.ok);
}

function updateAuthUi() {
  if (!authButton) return;
  const profile = authSession.user?.profile || {};
  const name = profile.displayName || profile.username || authSession.user?.email?.split("@")[0] || "Войти";
  const isLoggedIn = isAuthenticated();
  const staff = isStaff();
  authButton.dataset.viewLink = isLoggedIn ? "me" : "auth";
  authButton.setAttribute("href", isLoggedIn ? "/me" : "/auth");
  authButton.setAttribute("aria-label", isLoggedIn ? "Открыть личный кабинет" : "Войти");
  authButton.title = isLoggedIn ? "Личный кабинет" : "Войти";
  authButton.innerHTML = isLoggedIn
    ? `${avatarMarkup(name, profile.avatarUrl || "", "tiny")}<span>${escapeHtml(name)}</span>`
    : "Войти";
  document.querySelectorAll("[data-auth-feature]").forEach((element) => {
    element.classList.toggle("is-hidden", !isLoggedIn);
  });
  document.querySelectorAll("[data-guest-feature]").forEach((element) => {
    element.classList.toggle("is-hidden", isLoggedIn);
  });
  headerInboxButton?.classList.toggle("is-hidden", !isLoggedIn);
  logoutButton?.classList.toggle("is-hidden", !isLoggedIn);
  document.querySelectorAll("[data-staff-feature]").forEach((element) => {
    element.classList.toggle("is-hidden", !staff);
    element.setAttribute("aria-hidden", staff ? "false" : "true");
  });
  document.querySelectorAll("[data-owner-admin-feature]").forEach((element) => {
    const ownerAdmin = isOwnerAdmin();
    element.classList.toggle("is-hidden", !ownerAdmin);
    element.setAttribute("aria-hidden", ownerAdmin ? "false" : "true");
  });
  renderRoleNavigation();
  updateAdminRoleNote();
  applyAdminTab(activeAdminTab, { updateHistory: false, load: false });
  applyFeatureFlags();
  updateHeaderNotificationBadge();
  updateWriteAccessUi();
  applyAuthStateAttr();
}

function updateAdminRoleNote() {
  const note = document.querySelector("#admin-role-note");
  if (!note) return;
  if (!authSession.accessToken) {
    note.textContent = "Админ-разделы доступны только команде проекта.";
    return;
  }
  if (!isStaff()) {
    note.textContent = "У текущего аккаунта нет доступа к админке.";
    return;
  }
  note.textContent = isOwnerAdmin()
    ? "Доступны модерация, пользователи, каталог, реклама, платные функции, финансы, SEO и audit log."
    : "Доступны модерация, пользователи, каталог и реклама. Финансы, SEO, тарифы и запуск платных функций скрыты для OWNER/ADMIN.";
}

function monetizationEnabled() {
  return featureFlags.monetizationEnabled === true;
}

function aiEnabled() {
  return featureFlags.aiEnabled === true;
}

function applyFeatureFlags() {
  const ai = aiEnabled();
  document.querySelectorAll("[data-ai-feature]").forEach((element) => {
    const requiresAuth = element.hasAttribute("data-auth-feature");
    element.classList.toggle("is-hidden", !(ai && (!requiresAuth || isAuthenticated())));
  });
  const monetization = monetizationEnabled();
  document.querySelectorAll("[data-paid-feature]").forEach((element) => {
    const requiresAuth = element.hasAttribute("data-auth-feature");
    const requiresStaff = element.hasAttribute("data-staff-feature");
    const requiresOwnerAdmin = element.hasAttribute("data-owner-admin-feature");
    const visible = monetization
      && (!requiresAuth || isAuthenticated())
      && (!requiresStaff || isStaff())
      && (!requiresOwnerAdmin || isOwnerAdmin());
    element.classList.toggle("is-hidden", !visible);
  });
  if (!monetization) {
    renderSubscriptionStatus({ enabled: false });
    renderPlans([]);
    renderPayments([]);
  }
}

function updateHeaderNotificationBadge(notifications = latestNotifications) {
  if (!headerNotificationBadge) return;
  const unread = authSession.accessToken
    ? notifications.filter((notification) => !notification.isRead).length + headerInboxUnreadCount
    : 0;
  headerNotificationBadge.textContent = unread > 99 ? "99+" : String(unread);
  headerNotificationBadge.classList.toggle("is-hidden", unread <= 0);
  headerInboxButton?.setAttribute("aria-label", unread ? `Сообщения, непрочитанных: ${unread}` : "Сообщения");
}

function persistSession(session) {
  authSessionVersion += 1;
  authSession = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    user: session.user
  };
  localStorage.setItem("cofindAccessToken", session.accessToken);
  localStorage.setItem("cofindRefreshToken", session.refreshToken);
  localStorage.setItem("cofindUser", JSON.stringify(session.user));
  authResolved = true;
  updateAuthUi();
}

async function loadBlocks({ force = false } = {}) {
  if (!authSession.accessToken) {
    blocksCache = [];
    blocksLoaded = false;
    syncBlockedAuthorUi();
    return blocksCache;
  }
  if (blocksLoadingPromise && !force) return blocksLoadingPromise;
  blocksLoadingPromise = apiFetch("/me/blocks")
    .then((blocks) => {
      renderBlocks(Array.isArray(blocks) ? blocks : []);
      blocksLoaded = true;
      return blocksCache;
    })
    .catch(() => {
      blocksLoaded = true;
      syncBlockedAuthorUi();
      return blocksCache;
    })
    .finally(() => {
      blocksLoadingPromise = null;
    });
  return blocksLoadingPromise;
}

function saveSession(session) {
  persistSession(session);
  if (currentViewName() === "auth" && !document.querySelector("#me-display-name")) return;
  loadBlocks({ force: true });
  hydrateFromApi();
  connectChatSocket();
  loadMe();
  loadPreferences();
  loadInbox();
  loadMySuggestions();
  loadMyReports();
  loadPayments();
  loadAdminDashboard();
}

function clearStoredSession() {
  authSessionVersion += 1;
  authSession = { accessToken: null, refreshToken: null, user: null };
  localStorage.removeItem("cofindAccessToken");
  localStorage.removeItem("cofindRefreshToken");
  localStorage.removeItem("cofindUser");
  clearAuthHintCookie();
  authResolved = true;
  updateAuthUi();
}

async function logoutBeforeAuthSubmit() {
  clearStoredSession();
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" }
    });
  } catch {
    // The following login/register request can still replace the session.
  }
}

function clearUserActionState() {
  listings = listings.map((listing) => ({ ...listing, likedByMe: false }));
  if (selectedListing) selectedListing = { ...selectedListing, likedByMe: false };
  messages = messages.map((message) => ({ ...message, likedByMe: false, reactedByMe: {} }));
  renderListings();
  if (selectedListing) renderListingDetail(selectedListing);
  renderMessages();
}

function clearSession() {
  if (authSession.accessToken || authSession.refreshToken) {
    apiFetch("/auth/logout", { method: "POST", skipAuthRefresh: true }).catch(() => {});
  }
  clearStoredSession();
  pendingViewAfterAuth = null;
  pendingPathAfterAuth = null;
  latestNotifications = [];
  headerInboxUnreadCount = 0;
  adminLoadedTabs.clear();
  activeAdminTab = "overview";
  activePrivateConversationId = null;
  blocksCache = [];
  blocksLoaded = false;
  blocksLoadingPromise = null;
  inboxPayload = { conversations: [], sentResponses: [], incomingResponses: [] };
  inboxConversations = [];
  renderInbox(inboxPayload);
  const privateTitle = document.querySelector("#private-title");
  if (privateTitle) privateTitle.textContent = "Выберите диалог";
  renderPrivateMessages([]);
  setPrivateComposer(false, "Сначала войдите и откройте диалог из списка.");
  clearUserActionState();
  renderBlocks([]);
  updateAuthUi();
  chatSocket?.close();
  chatSocket = null;
  setWsStatus(false);
  loadAdminDashboard();
  if (authRequiredViews.has(currentViewName())) {
    setView("auth");
  }
  showToast("Вы вышли из аккаунта");
}

function shouldRefreshAuthForPath(path = "") {
  return !String(path).startsWith("/auth/login")
    && !String(path).startsWith("/auth/register")
    && !String(path).startsWith("/auth/refresh")
    && !String(path).startsWith("/auth/password-reset");
}

async function apiFetch(path, options = {}) {
  const { skipAuthRefresh, ...fetchOptions } = options;
  const headers = {
    Accept: "application/json",
    ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
    ...(authSession.accessToken ? { Authorization: `Bearer ${authSession.accessToken}` } : {}),
    ...fetchOptions.headers
  };
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include", ...fetchOptions, headers });
  if (!response.ok) {
    if (response.status === 401 && !skipAuthRefresh && shouldRefreshAuthForPath(path) && await refreshAuthSession()) {
      return apiFetch(path, { ...fetchOptions, skipAuthRefresh: true });
    }
    throw await apiError(response, path);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function refreshAuthSession() {
  const accessTokenAtStart = authSession.accessToken;
  const refreshTokenAtStart = authSession.refreshToken;
  const versionAtStart = authSessionVersion;
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: refreshTokenAtStart })
    });
    if (!response.ok) return false;
    const session = await response.json();
    if (
      authSessionVersion !== versionAtStart ||
      authSession.accessToken !== accessTokenAtStart ||
      authSession.refreshToken !== refreshTokenAtStart
    ) {
      return false;
    }
    persistSession(session);
    return true;
  } catch {
    return false;
  }
}

async function bootstrapAuthFromCookie() {
  if (authSession.accessToken) {
    authResolved = true;
    updateAuthUi();
    return false;
  }
  const restored = await refreshAuthSession();
  if (!restored) {
    // No live session behind the hint cookie: settle on the guest header.
    clearAuthHintCookie();
    authResolved = true;
    updateAuthUi();
    return false;
  }
  authResolved = true;
  updateAuthUi();
  await Promise.all([
    loadBlocks({ force: true }),
    loadMe(),
    loadPreferences(),
    loadInbox(),
    loadMySuggestions(),
    loadMyReports(),
    loadPayments()
  ]);
  connectChatSocket();
  openCurrentRoute({ updateHistory: false });
  return true;
}


async function apiError(response, path) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const message = Array.isArray(body?.message)
    ? body.message.join(", ")
    : body?.message || body?.error || text || `API error ${response.status}`;
  const error = new Error(message);
  error.status = response.status;
  error.path = body?.path || path;
  error.body = body;
  return error;
}

function setMeta(name, value, property = false) {
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let meta = document.querySelector(selector);
  if (!value) {
    meta?.remove();
    return;
  }
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(property ? "property" : "name", name);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", value);
}

function setLinkRel(rel, href) {
  let link = document.querySelector(`link[rel="${rel}"]`);
  if (!href) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", rel);
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

function setJsonLd(id, data) {
  let script = document.querySelector(`#${id}`);
  if (!data) {
    script?.remove();
    return;
  }
  if (!script) {
    script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}

function clipText(value, limit = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
}

function seoFallbackForView(name) {
  if (name === "listing" && selectedListing) {
    return {
      title: `${selectedListing.title} - заявка Cofind 2`,
      description: clipText(`${selectedListing.author}: ${selectedListing.body}`, 180),
      canonical: `${location.origin}${listingHref(selectedListing)}`,
      ogTitle: selectedListing.title,
      ogDescription: clipText(selectedListing.body, 220)
    };
  }
  if (name === "profile" && currentPublicProfile) {
    const displayName = currentPublicProfile.displayName || currentPublicProfile.username || "Автор";
    const avatar = currentPublicProfile.avatarUrl || "";
    return {
      title: `${displayName} - профиль автора Cofind 2`,
      description: clipText(currentPublicProfile.bio || `Публичный профиль ${displayName} на Cofind 2.`, 180),
      canonical: currentPublicProfile.username ? `${location.origin}${profileUrl(currentPublicProfile.username, publicProfileListingsPage)}` : `${location.origin}${location.pathname}`,
      ogTitle: `${displayName} - Cofind 2`,
      ogDescription: clipText(currentPublicProfile.bio || `Профиль автора ${displayName}.`, 220),
      ogImage: /^https?:\/\//i.test(avatar) ? avatar : undefined
    };
  }
  return defaultSeo[name] || {
    title: `${name} - Cofind 2`,
    description: "Cofind 2 - творческая платформа для поиска партнеров и команд."
  };
}

function updateStructuredData(name) {
  const url = `${location.origin}${location.pathname}${location.search}`;
  if (name === "home") {
    setJsonLd("cofind-jsonld", {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${location.origin}/#organization`,
          name: "Cofind 2",
          url: `${location.origin}/`,
          logo: `${location.origin}/og-image.png`
        },
        {
          "@type": "WebSite",
          "@id": `${location.origin}/#website`,
          name: "Cofind 2",
          url: `${location.origin}/`,
          publisher: { "@id": `${location.origin}/#organization` },
          potentialAction: {
            "@type": "SearchAction",
            target: `${location.origin}/feed?q={search_term_string}`,
            "query-input": "required name=search_term_string"
          }
        }
      ]
    });
    return;
  }
  if (name === "feed") {
    setJsonLd("cofind-jsonld", {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Лента заявок Cofind 2",
      url,
      itemListElement: listings.slice(0, 12).map((listing, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${location.origin}${listingHref(listing)}`,
        name: listing.title
      }))
    });
    return;
  }
  if (name === "listing" && selectedListing) {
    setJsonLd("cofind-jsonld", {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: selectedListing.title,
      description: clipText(selectedListing.body, 500),
      url: `${location.origin}${listingHref(selectedListing)}`,
      author: {
        "@type": "Person",
        name: selectedListing.author,
        url: selectedListing.authorUsername ? `${location.origin}/profile/${encodeURIComponent(selectedListing.authorUsername)}` : undefined
      },
      genre: [...new Set([...(selectedListing.genres || []), ...(selectedListing.fandoms || [])])],
      keywords: [...new Set([...(selectedListing.tags || []), ...(selectedListing.characters || [])])].join(", "),
      datePublished: selectedListing.publishedAt || selectedListing.createdAt
    });
    return;
  }
  if (name === "profile" && currentPublicProfile) {
    const displayName = currentPublicProfile.displayName || currentPublicProfile.username || "Автор";
    const socialUrls = profileSocialUrls(currentPublicProfile);
    const tags = [
      ...(currentPublicProfile.favoriteGenres || []),
      ...(currentPublicProfile.favoriteFandoms || []),
      ...(currentPublicProfile.favoriteCharacters || []),
      currentPublicProfile.writingStyle,
      currentPublicProfile.literacyLevel,
      currentPublicProfile.preferredPostLength,
      currentPublicProfile.activityLevel
    ].filter(Boolean);
    const stats = currentPublicProfile.stats || {};
    setJsonLd("cofind-jsonld", {
      "@context": "https://schema.org",
      "@type": "Person",
      name: displayName,
      description: clipText(currentPublicProfile.bio || "", 500),
      url: currentPublicProfile.username ? `${location.origin}/profile/${encodeURIComponent(currentPublicProfile.username)}` : url,
      image: /^https?:\/\//i.test(currentPublicProfile.avatarUrl || "") ? currentPublicProfile.avatarUrl : undefined,
      sameAs: socialUrls.length ? socialUrls : undefined,
      knowsAbout: tags.length ? [...new Set(tags)] : undefined,
      interactionStatistic: [
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/LikeAction",
          userInteractionCount: Number(stats.likes || 0)
        },
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/ReplyAction",
          userInteractionCount: Number(stats.responses || 0)
        }
      ]
    });
    return;
  }
  setJsonLd("cofind-jsonld", null);
}

async function updateSeo(name) {
  const fallback = seoFallbackForView(name);
  let seo = fallback;
  if (apiOnline) {
    try {
      seo = { ...fallback, ...(await apiFetch(`/seo/page?path=${encodeURIComponent(location.pathname || "/")}`) || {}) };
    } catch {
      seo = fallback;
    }
  }
  document.title = seo.title || fallback.title;
  const currentUrl = `${location.origin}${location.pathname}${location.search}`;
  const ogTitle = seo.ogTitle || seo.title || fallback.title;
  const ogDescription = seo.ogDescription || seo.description || fallback.description;
  const ogImage = seo.ogImage || `${location.origin}/og-image.png`;
  setMeta("description", seo.description || fallback.description);
  setMeta("og:title", ogTitle, true);
  setMeta("og:description", ogDescription, true);
  setMeta("og:url", currentUrl, true);
  setMeta("og:image", ogImage, true);
  setMeta("twitter:title", ogTitle);
  setMeta("twitter:description", ogDescription);
  setMeta("twitter:image", ogImage);
  setMeta("robots", isIndexableView(name) ? "index,follow" : "noindex,nofollow");
  setLinkRel("canonical", seo.canonical || currentUrl);
  updateStructuredData(name);
  if (name !== "feed") {
    setLinkRel("prev", null);
    setLinkRel("next", null);
  }
}

function viewPath(name) {
  const map = {
    home: "/",
    feed: feedUrlForPage(feedPage),
    chat: chatUrl(),
    auth: "/auth",
    me: "/me",
    inbox: inboxUrl(),
    "new-listing": "/me/listings/new",
    appearance: "/me/appearance",
    subscription: "/me/subscription",
    suggestions: "/suggestions",
    help: "/help",
    rules: "/rules",
    privacy: "/privacy",
    contacts: "/contacts",
    report: "/reports/new",
    admin: adminUrl(),
    "ai-partner": "/ai-partner",
    listing: selectedListing ? listingHref(selectedListing) : "/listing",
    profile: profileUrl()
  };
  return map[name] || `/${name}`;
}

function adminUrl(tab = activeAdminTab) {
  return tab && tab !== "overview" ? `/admin?tab=${encodeURIComponent(tab)}` : "/admin";
}

function chatUrl(room = activeChatRoom) {
  return room && room !== "general" ? `/chat?room=${encodeURIComponent(room)}` : "/chat";
}

function profileUrl(username = currentProfileUsername, page = publicProfileListingsPage, query = publicProfileListingsQuery, sort = publicProfileListingsSort) {
  const base = username ? `/profile/${encodeURIComponent(username)}` : "/profile";
  const params = new URLSearchParams();
  if (Number(page) > 1) params.set("listingsPage", String(page));
  if (query) params.set("q", query);
  if (sort && sort !== "new") params.set("sort", sort);
  const suffix = params.toString();
  return suffix ? `${base}?${suffix}` : base;
}

function applyChatRoomFromQuery(query = "") {
  const params = new URLSearchParams(query);
  const room = params.get("room") || "general";
  activeChatRoom = chatRooms.some((item) => item.slug === room) ? room : "general";
  localStorage.setItem(chatRoomKey, activeChatRoom);
  wireChatRooms();
}

function applyAdminStateFromQuery(query = "") {
  const params = new URLSearchParams(query);
  const tab = params.get("tab") || "overview";
  activeAdminTab = normalizeAdminTab(tab);
  applyAdminTab(activeAdminTab, { updateHistory: false, load: false });
}

function currentViewName() {
  const active = document.querySelector(".view.is-active");
  return active?.id?.replace(/^view-/, "") || "home";
}

function isIndexableView(name) {
  return ["home", "feed", "listing", "profile", "chat", "suggestions", "help", "rules", "privacy", "contacts"].includes(name);
}

function setView(name, options = {}) {
  closeMobileMenu();
  const normalized = name || "home";
  if (normalized === "subscription" && !monetizationEnabled()) {
    showToast("Платные функции пока не запущены");
    return setView("home", { ...options, url: "/", replace: true });
  }
  if (normalized === "admin" && authSession.accessToken && !isStaff()) {
    showToast("Админка доступна только модераторам и администраторам");
    return setView("me", { ...options, url: "/me", replace: true });
  }
  if (!options.skipAuthGuard && authRequiredViews.has(normalized) && !authSession.accessToken) {
    pendingViewAfterAuth = normalized;
    pendingPathAfterAuth = options.url || viewPath(normalized);
    showToast("Сначала войдите в аккаунт");
    return setView("auth", { skipAuthGuard: true, replace: true });
  }
  if (normalized === "auth") setAuthMode("login");
  const targetView = document.querySelector(`#view-${normalized}`);
  if (!targetView) {
    const targetUrl = options.url || viewPath(normalized);
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (targetUrl && targetUrl !== currentUrl) window.location.assign(targetUrl);
    return;
  }
  document.documentElement.dataset.initialView = normalized;
  views.forEach((view) => view.classList.toggle("is-active", view.id === `view-${normalized}`));
  document.querySelectorAll(".main-nav [data-view-link]").forEach((link) => {
    const isCurrent = link.dataset.viewLink === normalized;
    link.classList.toggle("is-active", isCurrent);
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (options.updateHistory !== false) {
    const targetUrl = options.url || viewPath(normalized);
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    const method = options.replace ? "replaceState" : "pushState";
    if (currentUrl !== targetUrl) history[method]({ view: normalized }, "", targetUrl);
  }
  updateSeo(normalized);
  if (normalized === "feed") renderFeedPagination(feedTotalPages);
  if (normalized === "chat") {
    renderMessages();
    keepMessagesAtBottom();
  }
  if (normalized === "admin") applyAdminTab(activeAdminTab, { updateHistory: false, load: true });
  if (normalized === "ai-partner") loadRpSessions();
  window.scrollTo({ top: 0, behavior: "smooth" });
  trackPageview();
}

function setAuthMode(mode = "login") {
  document.querySelectorAll("[data-auth-panel]").forEach((panel) => {
    panel.classList.toggle("is-hidden", panel.dataset.authPanel !== mode);
  });
  const focusTarget = mode === "register" ? "#register-email" : mode === "reset" ? "#reset-email" : "#login-email";
  document.querySelector(focusTarget)?.focus();
}

function applyPasswordResetFromQuery(query = "") {
  const params = new URLSearchParams(query);
  const token = (params.get("resetToken") || "").trim();
  if (!token) return false;
  setAuthMode("reset");
  const email = (params.get("email") || "").trim();
  const tokenInput = document.querySelector("#reset-token");
  const emailInput = document.querySelector("#reset-email");
  if (tokenInput) tokenInput.value = token;
  if (emailInput && email) emailInput.value = email;
  const note = document.querySelector("#reset-note");
  if (note) note.textContent = "Код восстановления подставлен. Задайте новый пароль и сохраните.";
  return true;
}


function wireAuthFallbackHandlers() {
  if (document.documentElement.dataset.authFallbackWired === "true") return;
  document.documentElement.dataset.authFallbackWired = "true";

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-auth-mode]");
    if (!button) return;
    event.preventDefault();
    setAuthMode(button.dataset.authMode || "login");
  }, true);

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!form?.id || !["login-form", "register-form", "reset-request-form", "reset-confirm-form"].includes(form.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      if (form.id === "login-form") {
        await logoutBeforeAuthSubmit();
        const session = await apiFetch("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: document.querySelector("#login-email")?.value || "",
            password: document.querySelector("#login-password")?.value || ""
          })
        });
        saveSession(session);
        showToast("Вы вошли в Cofind 2");
        completeAuthRedirect("me");
        return;
      }

      if (form.id === "register-form") {
        await logoutBeforeAuthSubmit();
        const session = await apiFetch("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email: document.querySelector("#register-email")?.value || "",
            username: document.querySelector("#register-username")?.value || "",
            displayName: document.querySelector("#register-display")?.value || "",
            password: document.querySelector("#register-password")?.value || ""
          })
        });
        saveSession(session);
        trackEvent("register");
        showToast("Аккаунт создан");
        completeAuthRedirect("me");
        return;
      }

      if (form.id === "reset-request-form") {
        const email = document.querySelector("#reset-email")?.value.trim() || "";
        const note = document.querySelector("#reset-note");
        const result = await apiFetch("/auth/password-reset/request", {
          method: "POST",
          body: JSON.stringify({ email })
        });
        if (result.resetToken) {
          const tokenInput = document.querySelector("#reset-token");
          if (tokenInput) tokenInput.value = result.resetToken;
          if (note) note.textContent = "Код восстановления получен. Проверьте новый пароль и сохраните его.";
        } else if (note) {
          note.textContent = "Если e-mail есть в системе, мы отправим инструкции восстановления.";
        }
        showToast("Запрос восстановления принят");
        return;
      }

      if (form.id === "reset-confirm-form") {
        await apiFetch("/auth/password-reset/confirm", {
          method: "POST",
          body: JSON.stringify({
            token: document.querySelector("#reset-token")?.value.trim() || "",
            newPassword: document.querySelector("#reset-new-password")?.value || ""
          })
        });
        form.reset();
        const note = document.querySelector("#reset-note");
        if (note) note.textContent = "Пароль обновлен. Теперь войдите по e-mail.";
        showToast("Пароль обновлен");
        setAuthMode("login");
        const loginEmail = document.querySelector("#login-email");
        const resetEmail = document.querySelector("#reset-email");
        if (loginEmail && resetEmail) loginEmail.value = resetEmail.value.trim();
      }
    } catch (error) {
      const messages = {
        "login-form": "Не удалось войти",
        "register-form": "Регистрация не прошла",
        "reset-request-form": "Не удалось запросить восстановление",
        "reset-confirm-form": "Не удалось обновить пароль"
      };
      showToast(apiFailure(messages[form.id] || "Действие не выполнено", error));
    }
  }, true);
}

wireAuthFallbackHandlers();

function completeAuthRedirect(fallback = "me") {
  const path = pendingPathAfterAuth;
  const view = pendingViewAfterAuth || fallback;
  pendingPathAfterAuth = null;
  pendingViewAfterAuth = null;
  if (path && openAppPath(path)) return;
  setView(view);
}

function routePart(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function openAppPath(path, { deferRemote = false, updateHistory = true } = {}) {
  const cleanPath = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const cleanQuery = path.includes("?") ? path.split("?")[1].split("#")[0] : "";
  const routeUrl = `${cleanPath}${cleanQuery ? `?${cleanQuery}` : ""}`;
  if (cleanPath === "/" || cleanPath.endsWith("/index.html")) return false;
  const parts = cleanPath.split("/").filter(Boolean);
  const section = parts[0];
  const value = routePart(parts[1] || "");
  if (section === "feed") {
    applyFeedStateFromQuery(path.split("?")[1] || "");
    setView("feed", { updateHistory });
    if (apiOnline) refreshFeedFromApi();
    else renderListings();
    return true;
  }
  if (section === "me" && parts[1] === "inbox") {
    applyInboxStateFromQuery(path.split("?")[1] || "");
    setView("inbox", { updateHistory, url: routeUrl });
    return true;
  }
  if (section === "chat") {
    applyChatRoomFromQuery(path.split("?")[1] || "");
    setView("chat", { updateHistory });
    renderMessages();
    return true;
  }
  if (section === "me" && parts[1] === "subscription") {
    if (!monetizationEnabled()) {
      setView("home", { updateHistory, url: "/" });
      return true;
    }
    setView("subscription", { updateHistory, url: routeUrl });
    return true;
  }
  if (section === "me" && parts[1] === "appearance") {
    setView("appearance", { updateHistory, url: routeUrl });
    return true;
  }
  if (section === "me" && parts[1] === "listings" && parts[2] === "new") {
    setView("new-listing", { updateHistory, url: routeUrl });
    return true;
  }
  if (section === "reports") {
    applyReportStateFromQuery(path.split("?")[1] || "");
    setView("report", { updateHistory, url: routeUrl });
    return true;
  }
  if (section === "admin") {
    applyAdminStateFromQuery(cleanQuery);
    setView("admin", { updateHistory, url: routeUrl });
    return true;
  }
  if ((section === "listing" || section === "listings") && value) {
    if (deferRemote) {
      deepLinkRoute = { type: "listing", value };
      const localListing = listings.find((listing) => String(listing.id) === String(value) || String(listing.slug) === String(value));
      if (localListing) renderListingDetail(localListing);
      setView("listing", { updateHistory });
    } else {
      deepLinkRoute = null;
      openListing(value);
    }
    return true;
  }
  if (["profile", "profiles", "u"].includes(section) && value) {
    const profileParams = new URLSearchParams(cleanQuery);
    const listingsPage = Math.max(1, Number(profileParams.get("listingsPage") || 1));
    const q = (profileParams.get("q") || "").trim();
    const sort = ["new", "popular", "responses"].includes(profileParams.get("sort")) ? profileParams.get("sort") : "new";
    if (deferRemote) {
      deepLinkRoute = { type: "profile", value, listingsPage, q, sort };
      currentProfileUsername = value;
      publicProfileListingsPage = listingsPage;
      publicProfileListingsQuery = q;
      publicProfileListingsSort = sort;
      setView("profile", { updateHistory, url: routeUrl });
    } else {
      deepLinkRoute = null;
      openProfile(value, { listingsPage, q, sort, updateHistory, url: routeUrl });
    }
    return true;
  }
  const viewByPath = {
    me: "me",
    inbox: "inbox",
    auth: "auth",
    subscription: "subscription",
    reports: "report",
    suggestions: "suggestions",
    help: "help",
    rules: "rules",
    privacy: "privacy",
    contacts: "contacts",
    admin: "admin",
    "ai-partner": "ai-partner",
    "new-listing": "new-listing"
  };
  if (section === "auth") {
    setView("auth", { updateHistory, url: routeUrl });
    applyPasswordResetFromQuery(cleanQuery);
    return true;
  }
  if (viewByPath[section]) {
    setView(viewByPath[section], { updateHistory, url: routeUrl });
    return true;
  }
  return false;
}

function openPathRoute({ deferRemote = false, updateHistory = true } = {}) {
  return openAppPath(`${location.pathname}${location.search}`, { deferRemote, updateHistory });
}

function openCurrentRoute({ updateHistory = false } = {}) {
  const hash = location.hash.slice(1);
  if (hash) {
    const [view, query = ""] = hash.split("?");
    if (view === "feed") applyFeedStateFromQuery(query);
    setView(view, { updateHistory });
    return;
  }
  if (!openPathRoute({ deferRemote: true, updateHistory })) setView("home", { updateHistory });
}

async function copyToClipboard(text, successMessage) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    showToast(successMessage);
  } catch {
    showToast("Не удалось скопировать ссылку");
  }
}

function downloadJsonFile(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function shouldUseNativeNavigation(event, target) {
  const anchor = target?.closest?.("a[href]");
  if (!anchor) return false;
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (anchor.target && anchor.target !== "_self");
}

function closeMobileMenu() {
  topbar?.classList.remove("is-menu-open");
  mobileMenuToggle?.setAttribute("aria-expanded", "false");
}

function toggleMobileMenu() {
  const expanded = !topbar?.classList.contains("is-menu-open");
  topbar?.classList.toggle("is-menu-open", expanded);
  mobileMenuToggle?.setAttribute("aria-expanded", String(expanded));
}

mobileMenuToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMobileMenu();
});

mobileMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", (event) => {
  if (!topbar?.classList.contains("is-menu-open")) return;
  if (topbar.contains(event.target)) return;
  closeMobileMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileMenu();
});

window.matchMedia("(min-width: 921px)").addEventListener("change", (event) => {
  if (event.matches) closeMobileMenu();
});

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("[data-view-link]");
  if (!link) return;
  const target = link.dataset.viewLink;
  if (!target) return;
  if (shouldUseNativeNavigation(event, link)) return;
  const href = link instanceof HTMLAnchorElement ? link.getAttribute("href") : null;
  const targetView = document.querySelector(`#view-${target}`);
  if (href && !targetView) {
    closeMobileMenu();
    return;
  }
  event.preventDefault();
  closeMobileMenu();
  if (target === "new-listing" && authSession.accessToken) resetListingEditor();
  setView(target, href ? { url: href } : {});
});

window.addEventListener("hashchange", () => openCurrentRoute({ updateHistory: false }));
window.addEventListener("popstate", () => openCurrentRoute({ updateHistory: false }));

const listingTypeLabels = {
  COAUTHOR_SEARCH: "Соавтор",
  ROLEPLAY_SEARCH: "Соигрок",
  BETA_READER_SEARCH: "Бета-ридер",
  TEAM_SEARCH: "Команда"
};

const listingRatingLabels = {
  EVERYONE: "Для всех",
  TEEN: "Teen",
  MATURE: "Mature",
  ADULT: "18+"
};

const listingStatusLabels = {
  DRAFT: "Черновик",
  PUBLISHED: "Открыта",
  CLOSED: "Закрыта",
  ARCHIVED: "В архиве",
  DELETED: "Удалена"
};

function listingTypeLabel(value) {
  return listingTypeLabels[value] || value || "Заявка";
}

function listingRatingLabel(value) {
  return listingRatingLabels[value] || value || "Рейтинг не указан";
}

function listingStatusLabel(item) {
  if (!item?.open) return listingStatusLabels[item?.status] || "Закрыта";
  return listingStatusLabels[item?.status] || "Открыта";
}

function listingUpdatedLabel(item) {
  const date = item?.publishedAt || item?.updatedAt || item?.createdAt;
  return date ? timeAgo(date) : item?.age || "недавно";
}

function listingTaxonomy(label, values = [], limit = 4) {
  const items = [...new Set(values.filter(Boolean))].slice(0, limit);
  if (!items.length) return "";
  return `
    <div class="listing-card-taxonomy">
      <span>${escapeHtml(label)}</span>
      <div class="tags">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    </div>
  `;
}

function listingCard(item) {
  const responseText = `${item.responses} ${plural(item.responses, ["отклик", "отклика", "откликов"])}`;
  const path = listingHref(item);
  const author = item.authorUsername
    ? `<a href="/profile/${encodeURIComponent(item.authorUsername)}" data-open-profile="${escapeHtml(item.authorUsername)}">${escapeHtml(item.author)}</a>`
    : escapeHtml(item.author);
  const summary = clipText(stripRichText(item.body), 260);
  const cta = item.open ? "Откликнуться" : "Подробнее";
  return `
    <article class="listing-card feed-listing-card" data-listing-id="${escapeHtml(item.id)}">
      <div class="card-topline">
        <div>
          <span class="pill ${item.rating === "ADULT" ? "warm" : "soft"}">${escapeHtml(listingTypeLabel(item.type))}</span>
          <span class="pill">${escapeHtml(listingRatingLabel(item.rating))}</span>
          <span class="pill ${item.open ? "soft" : "warm"}">${escapeHtml(listingStatusLabel(item))}</span>
        </div>
        <span>Обновлено ${escapeHtml(listingUpdatedLabel(item))}</span>
      </div>
      <h2><a href="${escapeHtml(path)}" data-open-listing="${escapeHtml(item.id)}">${escapeHtml(item.title)}</a></h2>
      <p>${escapeHtml(summary)}</p>
      <div class="listing-card-meta">
        <span>Автор: ${author}</span>
        <span>${responseText}</span>
      </div>
      ${listingTaxonomy("Жанры", item.genres)}
      ${listingTaxonomy("Фандомы", item.fandoms)}
      ${listingTaxonomy("Персонажи", item.characters)}
      <footer>
        <span>${escapeHtml(item.likes || 0)} ${plural(item.likes || 0, ["лайк", "лайка", "лайков"])}</span>
        <div class="button-row listing-card-actions">
          <a class="secondary-button" href="${escapeHtml(path)}" data-open-listing="${escapeHtml(item.id)}">${cta}</a>
          <button class="ghost-button ${item.likedByMe ? "is-active" : ""}" data-like-feed="${escapeHtml(item.id)}">${item.likedByMe ? "♥" : "♡"} ${item.likes}</button>
        </div>
      </footer>
    </article>
  `;
}

function homeListingCard(item) {
  const path = listingHref(item);
  const author = item.authorUsername
    ? `<a href="/profile/${encodeURIComponent(item.authorUsername)}" data-open-profile="${escapeHtml(item.authorUsername)}">${escapeHtml(item.author)}</a>`
    : escapeHtml(item.author);
  const tags = [...new Set([...(item.tags || []), ...(item.genres || []), ...(item.fandoms || []), ...(item.characters || [])])]
    .slice(0, 4)
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  return `
    <article class="home-live-listing" data-open-listing="${escapeHtml(item.id)}" tabindex="0">
      <div class="card-topline">
        <span class="pill ${item.rating === "ADULT" ? "warm" : "soft"}">${escapeHtml(item.type)}</span>
        <span>${escapeHtml(item.age)}</span>
      </div>
      <h3><a href="${escapeHtml(path)}" data-open-listing="${escapeHtml(item.id)}">${escapeHtml(item.title)}</a></h3>
      <p>${escapeHtml(clipText(stripRichText(item.body), 180))}</p>
      <div class="tags">${tags}</div>
      <footer>
        <span>${author}</span>
        <span>${escapeHtml(item.responses)} ${plural(item.responses, ["отклик", "отклика", "откликов"])}</span>
      </footer>
    </article>
  `;
}

function recentListingCard(item) {
  const path = listingHref(item);
  const tags = [...new Set([...(item.tags || []), ...(item.genres || []), ...(item.fandoms || []), ...(item.characters || [])])]
    .slice(0, 5)
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  return `
    <article class="home-live-listing" data-open-listing="${escapeHtml(item.id)}" tabindex="0">
      <div class="card-topline">
        <span class="pill ${item.rating === "ADULT" ? "warm" : "soft"}">${escapeHtml(item.type || "LISTING")}</span>
        <span>${escapeHtml(item.viewedAt ? timeAgo(item.viewedAt) : item.age || "недавно")}</span>
      </div>
      <h3><a href="${escapeHtml(path)}" data-open-listing="${escapeHtml(item.id)}">${escapeHtml(item.title)}</a></h3>
      <p>${escapeHtml(clipText(stripRichText(item.body || ""), 180))}</p>
      <div class="tags">${tags}</div>
    </article>
  `;
}

function persistRecentListings() {
  localStorage.setItem(recentListingsKey, JSON.stringify(recentListings.slice(0, 6)));
}

function renderRecentListings() {
  const box = document.querySelector("#home-recent-listings");
  if (!box) return;
  const visibleRecent = visibleListingsForUser(recentListings);
  box.innerHTML = visibleRecent.length
    ? visibleRecent.slice(0, 4).map(recentListingCard).join("")
    : `<article class="home-live-listing"><h3>История пока пустая</h3><p>Откройте несколько заявок из ленты, и быстрые ссылки появятся здесь.</p></article>`;
}

function loadRecentListings() {
  try {
    const raw = localStorage.getItem(recentListingsKey);
    recentListings = raw ? JSON.parse(raw).map(normalizeListing).filter((item) => item.id) : [];
  } catch {
    recentListings = [];
    localStorage.removeItem(recentListingsKey);
  }
  renderRecentListings();
}

function rememberRecentListing(item) {
  if (!item?.id) return;
  const normalized = normalizeListing(item);
  if (listingIsFromBlockedAuthor(normalized)) return;
  recentListings = [
    { ...normalized, viewedAt: new Date().toISOString() },
    ...recentListings.filter((listing) => String(listing.id) !== String(normalized.id))
  ].slice(0, 6);
  persistRecentListings();
  renderRecentListings();
}

function listingHref(listingOrId) {
  if (listingOrId && typeof listingOrId === "object") {
    if (listingOrId.slug) return `/listings/${encodeURIComponent(listingOrId.slug)}`;
    return listingOrId.id ? `/listing/${encodeURIComponent(listingOrId.id)}` : "/listing";
  }
  return listingOrId ? `/listing/${encodeURIComponent(listingOrId)}` : "/listing";
}

function isLikelyListingId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function renderHomeListings() {
  const box = document.querySelector("#home-live-listings");
  if (!box) return;
  const latest = visibleListingsForUser(listings)
    .sort((a, b) => {
      const aTime = a.publishedAt || a.createdAt ? new Date(a.publishedAt || a.createdAt).getTime() : a.created || 0;
      const bTime = b.publishedAt || b.createdAt ? new Date(b.publishedAt || b.createdAt).getTime() : b.created || 0;
      return bTime - aTime;
    })
    .slice(0, 4);
  box.innerHTML = latest.length
    ? latest.map(homeListingCard).join("")
    : `<article class="home-live-listing home-empty-listing"><h3>Заявок пока мало</h3><p>Создайте первую заявку и помогите запустить сообщество.</p><a class="secondary-button" href="/me/listings/new" data-view-link="new-listing">Создать заявку</a></article>`;
}

function normalizeSearchText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru-RU");
}

function includesSearchText(values = [], target = "") {
  const normalizedTarget = normalizeSearchText(target);
  if (!normalizedTarget) return true;
  return values.some((value) => normalizeSearchText(value) === normalizedTarget);
}

function renderListings() {
  const listEl = document.querySelector("#listing-list");
  // Preserve the server-rendered first page until the client has real API data.
  if (!feedApiLoaded && listEl?.dataset.ssrFeed === "pending" && listEl.childElementCount > 0) {
    return;
  }
  const search = normalizeSearchText(document.querySelector("#feed-search")?.value || "");
  const type = document.querySelector("#feed-type")?.value || "all";
  const rating = document.querySelector("#feed-rating")?.value || "all";
  const genre = document.querySelector("#feed-genre")?.value || "all";
  const fandom = document.querySelector("#feed-fandom")?.value || "all";
  const character = document.querySelector("#feed-character")?.value || "all";
  const onlyOpen = document.querySelector("#feed-open")?.checked;
  const onlyNew = document.querySelector("#feed-new")?.checked;

  let filtered = visibleListingsForUser(listings).filter((item) => {
    const haystack = normalizeSearchText([item.title, item.author, item.body, ...(item.tags || []), ...(item.genres || []), ...(item.fandoms || []), ...(item.characters || [])].join(" "));
    return (
      (!search || haystack.includes(search)) &&
      (type === "all" || item.type === type) &&
      (rating === "all" || item.rating === rating) &&
      (genre === "all" || includesSearchText(item.genres || [], genre)) &&
      (fandom === "all" || includesSearchText(item.fandoms || [], fandom)) &&
      (character === "all" || includesSearchText(item.characters || [], character)) &&
      (!onlyOpen || item.open) &&
      (!onlyNew || item.created >= 12)
    );
  });

  filtered = filtered.sort((a, b) => {
    if (activeSort === "popular") return b.likes - a.likes;
    if (activeSort === "unanswered") return a.responses - b.responses;
    return b.created - a.created;
  });

  const list = document.querySelector("#listing-list");
  const count = document.querySelector("#feed-count");
  if (!list || !count) return;
  const hasBlockedAuthors = Boolean(authSession.accessToken && blockedUserIds().size);
  const total = feedServerPagination && !hasBlockedAuthors ? feedServerPagination.total : filtered.length;
  const pageSize = feedServerPagination?.pageSize ?? feedPageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  feedTotalPages = totalPages;
  feedPage = Math.min(Math.max(1, feedPage), totalPages);
  const visible = feedServerPagination && !hasBlockedAuthors ? filtered : filtered.slice((feedPage - 1) * pageSize, feedPage * pageSize);
  count.textContent = `${total} ${plural(total, ["заявка", "заявки", "заявок"])}`;
  renderFeedFilterChips();
  renderFeedQuickFilters();

  if (visible.length) {
    list.innerHTML = visible.map(listingCard).join("");
  } else {
    const hasAnyListings = visibleListingsForUser(listings).length > 0;
    list.innerHTML = hasAnyListings
      ? `<article class="listing-card feed-empty-state"><h2>Пока нет заявок по выбранным фильтрам.</h2><p>Попробуйте расширить поиск или начните новый набор сами.</p><div class="button-row"><button type="button" class="secondary-button" data-empty-feed-action="reset">Сбросить фильтры</button><a class="ghost-button" href="/me/listings/new" data-view-link="new-listing">Создать заявку</a></div></article>`
      : `<article class="listing-card feed-empty-state"><h2>Заявок пока нет.</h2><p>Создайте первую заявку и помогите запустить сообщество.</p><div class="button-row"><a class="secondary-button" href="/me/listings/new" data-view-link="new-listing">Создать заявку</a></div></article>`;
  }
  renderFeedPagination(totalPages);
  renderHomeListings();
}

function renderFeedFilterChips() {
  const box = document.querySelector("#feed-active-filters");
  if (!box) return;
  const state = feedStatePayload();
  const chips = [];
  const labels = {
    q: "Поиск",
    type: "Тип",
    ageRating: "Рейтинг",
    genre: "Жанр",
    fandom: "Фандом",
    character: "Персонаж",
    open: "Открытые",
    recent: "Новые",
    sort: "Сортировка"
  };
  const sortLabels = { new: "Новые", popular: "Популярные", unanswered: "Без ответа" };
  if (state.q) chips.push({ key: "q", label: `${labels.q}: ${state.q}` });
  if (state.type && state.type !== "all") chips.push({ key: "type", label: `${labels.type}: ${listingTypeLabel(state.type)}` });
  if (state.ageRating && state.ageRating !== "all") chips.push({ key: "ageRating", label: `${labels.ageRating}: ${listingRatingLabel(state.ageRating)}` });
  ["genre", "fandom", "character"].forEach((key) => {
    if (state[key] && state[key] !== "all") chips.push({ key, label: `${labels[key]}: ${state[key]}` });
  });
  if (state.open) chips.push({ key: "open", label: labels.open });
  if (state.recent) chips.push({ key: "recent", label: labels.recent });
  if (state.sort && state.sort !== "new") chips.push({ key: "sort", label: `${labels.sort}: ${sortLabels[state.sort] || state.sort}` });
  box.innerHTML = chips.length
    ? chips.map((chip) => `<button type="button" data-remove-feed-filter="${escapeHtml(chip.key)}">${escapeHtml(chip.label)} <span aria-hidden="true">×</span></button>`).join("")
    : `<span class="muted-note">Выберите тип, жанр, фандом, персонажа или рейтинг, чтобы сузить поиск.</span>`;
}

function renderFeedQuickFilters() {
  const box = document.querySelector("#feed-quick-filters");
  if (!box) return;
  const state = feedStatePayload();
  const hasFocusedFilter = Boolean(
    state.q ||
    (state.type && state.type !== "all") ||
    (state.ageRating && state.ageRating !== "all") ||
    (state.genre && state.genre !== "all") ||
    (state.fandom && state.fandom !== "all") ||
    (state.character && state.character !== "all") ||
    state.open ||
    state.recent
  );
  box.querySelectorAll("[data-feed-quick]").forEach((button) => {
    const value = button.dataset.feedQuick;
    const selected =
      (value === "all" && !hasFocusedFilter) ||
      (value === "open" && state.open) ||
      (value === "new" && state.recent) ||
      (value?.startsWith("type:") && state.type === value.slice(5));
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function applyFeedQuickFilter(value = "all") {
  const controls = feedControls();
  if (value === "all") {
    resetFeedFilters({ updateUrl: true });
    return;
  }
  if (value.startsWith("type:")) {
    setSelectValue("#feed-type", value.slice(5));
  }
  if (value === "open" && controls.open) controls.open.checked = !controls.open.checked;
  if (value === "new" && controls.recent) controls.recent.checked = !controls.recent.checked;
  feedPage = 1;
  scheduleFeedRefresh();
}

function toggleFeedFilters(force) {
  const panel = document.querySelector("#feed-filters");
  const button = document.querySelector("#feed-filter-toggle");
  if (!panel || !button) return;
  const next = typeof force === "boolean" ? force : !panel.classList.contains("is-open");
  panel.classList.toggle("is-open", next);
  button.setAttribute("aria-expanded", String(next));
}

function renderFeedPagination(totalPages) {
  const box = document.querySelector("#feed-pagination");
  if (!box) return;
  if (totalPages <= 1) {
    box.innerHTML = "";
    if (currentViewName() === "feed") {
      setLinkRel("prev", null);
      setLinkRel("next", null);
    }
    return;
  }
  if (currentViewName() === "feed") {
    setLinkRel("canonical", `${location.origin}${feedUrlForPage(feedPage)}`);
    setLinkRel("prev", feedPage > 1 ? `${location.origin}${feedUrlForPage(feedPage - 1)}` : null);
    setLinkRel("next", feedPage < totalPages ? `${location.origin}${feedUrlForPage(feedPage + 1)}` : null);
  }
  const pages = [];
  const start = Math.max(1, feedPage - 2);
  const end = Math.min(totalPages, feedPage + 2);
  if (feedPage > 1) pages.push({ page: feedPage - 1, label: "Назад" });
  for (let page = start; page <= end; page += 1) pages.push({ page, label: String(page), current: page === feedPage });
  if (feedPage < totalPages) pages.push({ page: feedPage + 1, label: "Вперед" });
  box.innerHTML = `
    <span>${escapeHtml(feedPage)} / ${escapeHtml(totalPages)}</span>
    ${pages.map((item) => `
      <a href="${escapeHtml(feedUrlForPage(item.page))}" class="${item.current ? "is-current" : ""}" data-feed-page="${escapeHtml(item.page)}" ${item.current ? 'aria-current="page"' : ""}>${escapeHtml(item.label)}</a>
    `).join("")}
  `;
}

// Russian pluralization. forms = [one, few, many]; correctly handles the 11-14
// exception. Mirror of apps/api/src/common/pluralize.ts (kept in sync by hand).
function pluralize(number, forms) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
function plural(number, forms) {
  // Backwards-compatible alias for existing call sites (hoisted, like pluralize).
  return pluralize(number, forms);
}

function timeAgo(dateValue) {
  const time = dateValue ? new Date(dateValue).getTime() : Date.now();
  const days = Math.max(0, Math.round((Date.now() - time) / 86_400_000));
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  return `${days} ${plural(days, ["день", "дня", "дней"])} назад`;
}

function activityLabel(dateValue) {
  if (!dateValue) return "активность неизвестна";
  const diff = Math.max(0, Date.now() - new Date(dateValue).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 5) return "онлайн недавно";
  if (minutes < 60) return `${minutes} ${plural(minutes, ["минута", "минуты", "минут"])} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, ["час", "часа", "часов"])} назад`;
  return timeAgo(dateValue);
}

function compactNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(number)
    : "0";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHttpUrl(value = "", { prefixBare = false } = {}) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /[\u0000-\u001f\s]/.test(trimmed)) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return "";
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : prefixBare ? `https://${trimmed}` : "";
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function safeImageUrl(value = "") {
  const trimmed = String(value || "").trim();
  if (/^data:image\/(png|jpeg|webp);base64,/i.test(trimmed)) return trimmed;
  return safeHttpUrl(trimmed);
}

function normalizeUploadedImageUrl(value = "") {
  const safe = safeImageUrl(value);
  if (!safe || safe.startsWith("data:image/")) return safe;
  try {
    const url = new URL(safe);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (localHost && url.pathname.includes("/api/v1/uploads/images/")) {
      const filePath = url.pathname.slice(url.pathname.indexOf("/uploads/images/"));
      return `${API_BASE.replace(/\/+$/, "")}${filePath}`;
    }
    return url.href;
  } catch {
    return "";
  }
}

function safeAvatarUrl(value = "") {
  const trimmed = String(value || "").trim();
  if (/^gradient-[a-z0-9-]+$/i.test(trimmed)) return trimmed;
  return safeImageUrl(trimmed);
}

function normalizeWebsiteUrl(value = "") {
  return safeHttpUrl(value, { prefixBare: true });
}

function normalizeTelegramUrl(value = "") {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\/(t\.me|telegram\.me)\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").split(/[/?#]/)[0];
  return handle ? `https://t.me/${encodeURIComponent(handle)}` : "";
}

function profileSocialUrls(profile = {}) {
  const socials = profile.socialLinks && typeof profile.socialLinks === "object" && !Array.isArray(profile.socialLinks)
    ? profile.socialLinks
    : {};
  return [normalizeWebsiteUrl(socials.website), normalizeTelegramUrl(socials.telegram)].filter(Boolean);
}

function renderProfileSocials(profile = {}) {
  const socials = profile.socialLinks && typeof profile.socialLinks === "object" && !Array.isArray(profile.socialLinks)
    ? profile.socialLinks
    : {};
  const items = [];
  const website = normalizeWebsiteUrl(socials.website);
  const telegram = normalizeTelegramUrl(socials.telegram);
  if (website) items.push(`<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Сайт</a>`);
  if (telegram) items.push(`<a href="${escapeHtml(telegram)}" target="_blank" rel="noopener noreferrer">Telegram</a>`);
  if (socials.discord) items.push(`<span>Discord: ${escapeHtml(socials.discord)}</span>`);
  return items.join("");
}

function renderProfileFormat(profile = {}) {
  const items = [
    ["Стиль", profile.writingStyle],
    ["Грамотность", profile.literacyLevel],
    ["Длина поста", profile.preferredPostLength],
    ["Темп", profile.activityLevel],
    ["Связь", profile.communicationPreferences]
  ].filter(([, value]) => value);
  return items.map(([label, value]) => `
    <article>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </article>
  `).join("");
}

function richInline(value) {
  // Links are intentionally not rendered (anti-abuse): markdown link / autolink
  // syntax is left as plain text rather than turned into clickable anchors.
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function hasRichHtml(value) {
  return /<\/?(p|br|strong|b|em|i|s|ul|ol|li|blockquote|a|code)\b/i.test(String(value || ""));
}

function sanitizeRichHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  // Links (<a>) are intentionally NOT allowed (anti-abuse) — they get unwrapped
  // to their text content like any other disallowed tag.
  const allowedTags = new Set(["P", "BR", "STRONG", "B", "EM", "I", "S", "UL", "OL", "LI", "BLOCKQUOTE", "CODE"]);
  const cleanNode = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child;
      if (!allowedTags.has(element.tagName)) {
        cleanNode(element);
        element.replaceWith(...element.childNodes);
        return;
      }
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      cleanNode(element);
    });
  };
  cleanNode(template.content);
  return template.innerHTML;
}

function sanitizeAdHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  const allowedTags = new Set(["A", "BR", "EM", "IMG", "P", "SPAN", "STRONG"]);
  const cleanNode = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const element = child;
      if (!allowedTags.has(element.tagName)) {
        cleanNode(element);
        element.replaceWith(...element.childNodes);
        return;
      }
      const href = element.tagName === "A" ? safeHttpUrl(element.getAttribute("href") || "") : "";
      const src = element.tagName === "IMG" ? safeHttpUrl(element.getAttribute("src") || "") : "";
      const alt = element.tagName === "IMG" ? element.getAttribute("alt") || "" : "";
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      if (element.tagName === "A") {
        if (!href) {
          element.replaceWith(...element.childNodes);
          return;
        }
        element.setAttribute("href", href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
      if (element.tagName === "IMG") {
        if (!src) {
          element.remove();
          return;
        }
        element.setAttribute("src", src);
        element.setAttribute("alt", alt.slice(0, 120));
        element.setAttribute("loading", "lazy");
      }
      cleanNode(element);
    });
  };
  cleanNode(template.content);
  return template.innerHTML;
}

function plainTextToHtml(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function richValueToEditorHtml(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (hasRichHtml(raw)) return sanitizeRichHtml(raw);
  return richTextToHtml(raw).replace(/^<div class="rich-content">|<\/div>$/g, "") || plainTextToHtml(raw);
}

function richTextToHtml(value) {
  if (hasRichHtml(value)) {
    const html = sanitizeRichHtml(value);
    return html ? `<div class="rich-content">${html}</div>` : "";
  }
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let listItems = [];
  const closeList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${richInline(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (listMatch) {
      listItems.push(listMatch[1]);
      continue;
    }
    closeList();
    const quoteMatch = trimmed.match(/^>\s?(.+)/);
    if (quoteMatch) blocks.push(`<blockquote>${richInline(quoteMatch[1])}</blockquote>`);
    else blocks.push(`<p>${richInline(trimmed)}</p>`);
  }
  closeList();
  return blocks.length ? `<div class="rich-content">${blocks.join("")}</div>` : "";
}

function stripRichText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|blockquote|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function richPlainLength(value) {
  return stripRichText(value).length;
}

function richStoredLength(value) {
  return String(value || "").trim().length;
}

function richWithinStoredLimit(value, limit = 4000) {
  return richStoredLength(value) <= limit;
}

function normalizeRichUrl(value = "") {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function updateRichPreview(textareaId) {
  if (richEditors.has(textareaId)) {
    const previewMap = {
      "listing-response-message": "#listing-response-preview",
      "private-message-input": "#private-rich-preview"
    };
    document.querySelector(previewMap[textareaId])?.classList.add("is-hidden");
    return;
  }
  const previewMap = {
    "listing-response-message": "#listing-response-preview",
    "private-message-input": "#private-rich-preview"
  };
  const preview = document.querySelector(previewMap[textareaId]);
  const textarea = document.querySelector(`#${textareaId}`);
  if (!preview || !textarea) return;
  const value = textarea.value.trim();
  preview.classList.toggle("is-hidden", !value);
  preview.innerHTML = value ? richTextToHtml(value) : "";
}

function updateAllRichPreviews() {
  ["listing-response-message", "private-message-input"].forEach(updateRichPreview);
}

const richEditorIds = ["listing-body-input", "listing-response-message", "chat-input", "private-message-input"];
const richEditors = new Map();
const richEditorEmojis = ["😊", "😍", "🥰", "😂", "😭", "🤔", "✨", "🔥", "🌙", "🔮", "📖", "✍️", "💫", "💜", "🫶"];

function richEditorPlainText(editor) {
  return (editor?.innerText || "").replace(/\u00a0/g, " ").trim();
}

function syncTextareaFromRichEditor(textarea, editor) {
  textarea.value = richEditorPlainText(editor) ? sanitizeRichHtml(editor.innerHTML) : "";
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function autoGrowRichEditor(item) {
  if (!item?.editor) return;
  const minHeight = item.textarea.id === "listing-body-input" ? 230 : 130;
  item.editor.style.height = "auto";
  item.editor.style.height = `${Math.max(minHeight, item.editor.scrollHeight)}px`;
}

function syncRichEditorFromTextarea(textareaId) {
  const item = richEditors.get(textareaId);
  if (!item || !item.editor) return;
  // setContent(html, emitUpdate=false): push the textarea value into the editor
  // without firing onUpdate (avoids a sync loop). Used on draft restore / reset.
  item.editor.commands.setContent(item.textarea.value || "", false);
  updateEditorToolbarState(item);
}

function syncAllRichEditorsFromTextareas() {
  richEditorIds.forEach(syncRichEditorFromTextarea);
}

function focusRichEditor(textareaId) {
  const item = richEditors.get(textareaId);
  if (item?.editor) item.editor.commands.focus();
  else document.querySelector(`#${textareaId}`)?.focus();
}

function updateRichEditorPlaceholder(item) {
  item.shell.classList.toggle("is-empty", !richEditorPlainText(item.editor));
  item.shell.classList.toggle("is-disabled", item.textarea.disabled);
  item.editor.contentEditable = item.textarea.disabled ? "false" : "true";
  item.toolbar.querySelectorAll("[data-rich-command]").forEach((button) => {
    button.disabled = item.textarea.disabled;
    const command = button.dataset.richCommand;
    if (command === "quote") {
      button.classList.toggle("is-active", Boolean(currentRichBlockquote(item)));
      return;
    }
    const stateCommand = {
      bold: "bold",
      italic: "italic",
      strike: "strikeThrough",
      unordered: "insertUnorderedList",
      ordered: "insertOrderedList"
    }[command];
    if (stateCommand) button.classList.toggle("is-active", document.queryCommandState(stateCommand));
  });
  autoGrowRichEditor(item);
}

function updateRichEditorDisabled(textareaId) {
  const item = richEditors.get(textareaId);
  if (!item || !item.editor) return;
  item.editor.setEditable(!item.textarea.disabled);
  updateEditorToolbarState(item);
}

function richToolbarButton(command, label, content, extra = "") {
  return `<button type="button" data-rich-command="${command}" aria-label="${label}" title="${label}" ${extra}>${content}</button>`;
}

function richToolbarHtml() {
  return `
    ${richToolbarButton("bold", "Жирный (Ctrl+B)", "<strong>B</strong>")}
    ${richToolbarButton("italic", "Курсив (Ctrl+I)", "<em>I</em>")}
    ${richToolbarButton("strike", "Зачеркнутый", "<span class=\"strike-icon\">S</span>")}
    <span class="rich-divider" aria-hidden="true"></span>
    ${richToolbarButton("unordered", "Маркированный список", "•")}
    ${richToolbarButton("ordered", "Нумерованный список", "1.")}
    ${richToolbarButton("quote", "Цитата", "❝")}
    ${richToolbarButton("link", "Ссылка", "↗")}
    <span class="rich-divider" aria-hidden="true"></span>
    ${richToolbarButton("undo", "Отменить", "↶")}
    ${richToolbarButton("redo", "Повторить", "↷")}
    ${richToolbarButton("clear", "Очистить форматирование", "Tx")}
    ${richToolbarButton("emoji", "Эмодзи", "☺", "data-rich-emoji-toggle=\"true\"")}
  `;
}

function richSelectionBelongsToEditor(item, range) {
  if (!item?.editor || !range) return false;
  return item.editor.contains(range.commonAncestorContainer);
}

function saveRichSelection(item) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return richSelectionBelongsToEditor(item, range) ? range.cloneRange() : null;
}

function restoreRichSelection(item) {
  const selection = window.getSelection();
  if (!selection || !item.savedRange) {
    item.editor.focus();
    return false;
  }
  item.editor.focus();
  selection.removeAllRanges();
  selection.addRange(item.savedRange);
  return true;
}

function currentRichRange(item) {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (richSelectionBelongsToEditor(item, range)) return range;
  }
  return item?.savedRange && richSelectionBelongsToEditor(item, item.savedRange) ? item.savedRange : null;
}

function richRangeElement(range) {
  if (!range) return null;
  const node = range.commonAncestorContainer;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

function currentRichBlockquote(item) {
  const blockquote = richRangeElement(currentRichRange(item))?.closest?.("blockquote");
  return blockquote && item.editor.contains(blockquote) ? blockquote : null;
}

function selectedRichText(item) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return "";
  const range = selection.getRangeAt(0);
  if (!richSelectionBelongsToEditor(item, range) || selection.isCollapsed) return "";
  return selection.toString().trim();
}

function insertRichHtml(item, html) {
  item.editor.focus();
  if (document.queryCommandSupported?.("insertHTML")) {
    document.execCommand("insertHTML", false, html);
    return;
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const template = document.createElement("template");
  template.innerHTML = html;
  range.insertNode(template.content);
}

function selectedLinesToListHtml(text, ordered = false) {
  const items = String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/^(\d+[.)]|[-*])\s+/, "").trim())
    .filter(Boolean);
  if (!items.length) return "";
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</${tag}>`;
}

function quoteSelectionHtml(text) {
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<blockquote>${blocks || "<p><br></p>"}</blockquote>`;
}

function moveCaretAfterNode(node) {
  const selection = window.getSelection();
  if (!selection || !node?.parentNode) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function moveCaretInsideNode(node) {
  const selection = window.getSelection();
  if (!selection || !node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function unwrapRichBlockquote(item, blockquote) {
  if (!blockquote || !item.editor.contains(blockquote)) return false;
  const fragment = document.createDocumentFragment();
  while (blockquote.firstChild) fragment.append(blockquote.firstChild);
  const lastNode = fragment.lastChild;
  blockquote.replaceWith(fragment);
  if (lastNode) moveCaretAfterNode(lastNode);
  syncTextareaFromRichEditor(item.textarea, item.editor);
  updateRichEditorPlaceholder(item);
  item.savedRange = saveRichSelection(item);
  return true;
}

function richCaretAtEndOfNode(node) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed || !node) return false;
  const range = selection.getRangeAt(0);
  if (!node.contains(range.endContainer)) return false;
  const after = range.cloneRange();
  after.selectNodeContents(node);
  after.setStart(range.endContainer, range.endOffset);
  return !after.toString().trim();
}

function exitRichBlockquote(item, blockquote) {
  if (!blockquote || !item.editor.contains(blockquote)) return false;
  const paragraph = document.createElement("p");
  paragraph.innerHTML = "<br>";
  blockquote.after(paragraph);
  moveCaretInsideNode(paragraph);
  syncTextareaFromRichEditor(item.textarea, item.editor);
  updateRichEditorPlaceholder(item);
  item.savedRange = saveRichSelection(item);
  return true;
}

function applyRichListCommand(item, ordered = false) {
  restoreRichSelection(item);
  const selectedText = selectedRichText(item);
  const command = ordered ? "insertOrderedList" : "insertUnorderedList";
  const ok = document.execCommand(command);
  if (!ok) insertRichHtml(item, selectedText ? selectedLinesToListHtml(selectedText, ordered) : `<${ordered ? "ol" : "ul"}><li><br></li></${ordered ? "ol" : "ul"}>`);
}

function applyRichQuoteCommand(item) {
  restoreRichSelection(item);
  const activeQuote = currentRichBlockquote(item);
  if (activeQuote) {
    unwrapRichBlockquote(item, activeQuote);
    return;
  }
  const selectedText = selectedRichText(item);
  const ok = document.execCommand("formatBlock", false, "blockquote");
  const hasBlockquote = item.editor.querySelector("blockquote");
  if (!ok || (selectedText && !hasBlockquote)) insertRichHtml(item, quoteSelectionHtml(selectedText));
}

function applyRichLinkCommand(item) {
  const entered = window.prompt("URL ссылки", "https://");
  const url = normalizeRichUrl(entered || "");
  if (!url || !/^https?:\/\/[^\s]+$/i.test(url)) return;
  restoreRichSelection(item);
  const selectedText = selectedRichText(item);
  if (selectedText) document.execCommand("createLink", false, url);
  else insertRichHtml(item, `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`);
}

function execRichCommand(item, command) {
  restoreRichSelection(item);
  if (command === "bold") document.execCommand("bold");
  if (command === "italic") document.execCommand("italic");
  if (command === "strike") document.execCommand("strikeThrough");
  if (command === "unordered") applyRichListCommand(item, false);
  if (command === "ordered") applyRichListCommand(item, true);
  if (command === "quote") applyRichQuoteCommand(item);
  if (command === "undo") document.execCommand("undo");
  if (command === "redo") document.execCommand("redo");
  if (command === "clear") document.execCommand("removeFormat");
  if (command === "link") applyRichLinkCommand(item);
  syncTextareaFromRichEditor(item.textarea, item.editor);
  updateRichEditorPlaceholder(item);
  item.savedRange = saveRichSelection(item);
}

function openRichEmojiPicker(item) {
  item.emojiPicker.classList.toggle("is-hidden");
}

const EDITOR_BUNDLE_URL = "/vendor/editor.js";
let editorBundlePromise = null;

// Lazy-load the self-hosted TipTap bundle once (only on pages that have an editor).
function ensureEditorBundle() {
  if (window.CofindRichText) return Promise.resolve(window.CofindRichText);
  if (editorBundlePromise) return editorBundlePromise;
  editorBundlePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = EDITOR_BUNDLE_URL;
    script.onload = () => resolve(window.CofindRichText);
    script.onerror = () => reject(new Error("rich-text editor bundle failed to load"));
    document.head.append(script);
  });
  return editorBundlePromise;
}

const EDITOR_TOOLBAR = [
  { command: "bold", label: "Жирный (Ctrl+B)", content: "<strong>B</strong>" },
  { command: "italic", label: "Курсив (Ctrl+I)", content: "<em>I</em>" },
  { command: "strike", label: "Зачёркнутый", content: '<span class="strike-icon">S</span>' },
  { divider: true },
  { command: "bulletList", label: "Маркированный список", content: "•" },
  { command: "orderedList", label: "Нумерованный список", content: "1." },
  { command: "blockquote", label: "Цитата", content: "❝" },
  { divider: true },
  { command: "undo", label: "Отменить", content: "↶" },
  { command: "redo", label: "Повторить", content: "↷" },
  { command: "emoji", label: "Эмодзи", content: "☺" }
];

function buildEditorToolbarHtml() {
  return EDITOR_TOOLBAR.map((entry) =>
    entry.divider
      ? '<span class="rich-divider" aria-hidden="true"></span>'
      : `<button type="button" data-rich-command="${entry.command}" aria-label="${entry.label}" title="${entry.label}">${entry.content}</button>`
  ).join("");
}

function runEditorCommand(item, command) {
  const chain = () => item.editor.chain().focus();
  switch (command) {
    case "bold": chain().toggleBold().run(); break;
    case "italic": chain().toggleItalic().run(); break;
    case "strike": chain().toggleStrike().run(); break;
    case "bulletList": chain().toggleBulletList().run(); break;
    case "orderedList": chain().toggleOrderedList().run(); break;
    case "blockquote": chain().toggleBlockquote().run(); break;
    case "undo": chain().undo().run(); break;
    case "redo": chain().redo().run(); break;
    case "emoji": item.emojiPicker.classList.toggle("is-hidden"); break;
    default: break;
  }
}

function updateEditorToolbarState(item) {
  if (!item.editor) return;
  const disabled = item.textarea.disabled;
  item.shell.classList.toggle("is-disabled", disabled);
  item.toolbar.querySelectorAll("[data-rich-command]").forEach((btn) => {
    btn.disabled = disabled;
    const command = btn.dataset.richCommand;
    if (["bold", "italic", "strike", "bulletList", "orderedList", "blockquote"].includes(command)) {
      btn.classList.toggle("is-active", item.editor.isActive(command));
    }
  });
}

function syncTextareaFromEditor(item) {
  if (!item.editor) return;
  const html = item.editor.getHTML();
  const hasContent = item.editor.getText().trim().length > 0;
  item.textarea.value = hasContent ? sanitizeRichHtml(html) : "";
  item.textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function createRichEditor(textarea) {
  if (!textarea || richEditors.has(textarea.id) || !window.CofindRichText) return;
  const toolbar = textarea.previousElementSibling?.matches?.(".rich-toolbar")
    ? textarea.previousElementSibling
    : [...document.querySelectorAll(".rich-toolbar")].find((element) => element.dataset.editorTarget === textarea.id);
  if (!toolbar) return;
  const { Editor, StarterKit, Placeholder } = window.CofindRichText;

  const shell = document.createElement("div");
  shell.className = "rich-editor-shell";
  shell.dataset.richEditorFor = textarea.id;
  toolbar.innerHTML = buildEditorToolbarHtml();
  toolbar.classList.add("rich-toolbar-native");

  const mount = document.createElement("div");
  mount.className = "rich-editor";

  const emojiPicker = document.createElement("div");
  emojiPicker.className = "rich-emoji-picker is-hidden";
  emojiPicker.innerHTML = richEditorEmojis.map((emoji) => `<button type="button" data-rich-emoji="${emoji}" aria-label="Вставить ${emoji}">${emoji}</button>`).join("");

  textarea.classList.add("rich-source");
  textarea.setAttribute("aria-hidden", "true");
  textarea.tabIndex = -1;
  textarea.after(shell);
  shell.append(toolbar, mount, emojiPicker);

  // item is declared before the editor so the synchronous initial transaction
  // fired by `new Editor` finds a (partially populated) item via the closure.
  const item = { textarea, toolbar, shell, emojiPicker, editor: null };
  item.editor = new Editor({
    element: mount,
    editable: !textarea.disabled,
    content: textarea.value || "",
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: textarea.placeholder || "Начните писать..." })
    ],
    onUpdate: () => { syncTextareaFromEditor(item); updateEditorToolbarState(item); },
    onSelectionUpdate: () => updateEditorToolbarState(item)
  });
  richEditors.set(textarea.id, item);

  toolbar.addEventListener("mousedown", (event) => { if (event.target.closest("button")) event.preventDefault(); });
  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rich-command]");
    if (!button || button.disabled) return;
    runEditorCommand(item, button.dataset.richCommand);
  });
  emojiPicker.addEventListener("mousedown", (event) => event.preventDefault());
  emojiPicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rich-emoji]");
    if (!button) return;
    item.editor.chain().focus().insertContent(button.dataset.richEmoji).run();
    emojiPicker.classList.add("is-hidden");
  });
  updateEditorToolbarState(item);
}

async function initializeRichEditors() {
  const present = richEditorIds.map((id) => document.querySelector(`#${id}`)).filter(Boolean);
  if (!present.length) return; // no editor on this page — don't load the bundle
  try {
    await ensureEditorBundle();
  } catch {
    return; // leave the plain textareas usable if the bundle fails to load
  }
  present.forEach(createRichEditor);
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value) {
  return value ? new Date(value).toISOString() : null;
}

function relationNames(items, key) {
  if (!Array.isArray(items)) return [];
  return items.map((entry) => entry?.[key]?.name || entry?.name || entry).filter(Boolean);
}

function relationSlugs(items, key) {
  if (!Array.isArray(items)) return [];
  return items.map((entry) => entry?.[key]?.slug || entry?.slug || entry).filter(Boolean);
}

function splitCommaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function initialsFrom(value) {
  return String(value || "CO").slice(0, 2).toUpperCase();
}

function avatarMarkup(name, avatarUrl = "", classes = "") {
  const className = `avatar ${classes}`.trim();
  const safeName = escapeHtml(initialsFrom(name));
  const safeAvatar = safeAvatarUrl(avatarUrl);
  if (!safeAvatar) return `<div class="${className}">${safeName}</div>`;
  const presetClass = safeAvatar.startsWith("gradient-") ? ` ${safeAvatar}` : "";
  const content = safeAvatar.startsWith("data:image/") || /^https?:\/\//i.test(safeAvatar)
    ? `<img src="${escapeHtml(safeAvatar)}" alt="" loading="lazy" decoding="async" />`
    : safeName;
  return `<div class="${className}${presetClass}">${content}</div>`;
}

function setAvatarElement(element, name, avatarUrl = "") {
  if (!element) return;
  element.className = element.className
    .split(" ")
    .filter((item) => !item.startsWith("gradient-"))
    .join(" ");
  const safeAvatar = safeAvatarUrl(avatarUrl);
  element.innerHTML = safeAvatar && (safeAvatar.startsWith("data:image/") || /^https?:\/\//i.test(safeAvatar))
    ? `<img src="${escapeHtml(safeAvatar)}" alt="" loading="lazy" decoding="async" />`
    : escapeHtml(initialsFrom(name));
  if (safeAvatar?.startsWith("gradient-")) element.classList.add(safeAvatar);
}

function cssImageUrl(imageUrl = "") {
  const safeUrl = safeImageUrl(imageUrl);
  if (!safeUrl) return "";
  return `url("${safeUrl.replace(/["\\]/g, "")}")`;
}

function setCoverElement(element, coverUrl = "") {
  if (!element) return;
  const image = cssImageUrl(coverUrl);
  element.style.backgroundImage = image;
  element.style.backgroundSize = image ? "cover" : "";
  element.style.backgroundPosition = image ? "center" : "";
  element.classList.toggle("has-cover-image", Boolean(image));
}

function normalizeListing(item) {
  const rawTags = item.tags || [];
  // Public endpoints return a flat author DTO ({id, username, displayName,
  // avatarUrl, bio}); owner/admin endpoints still return the raw User+profile.
  const authorObj = item.author && typeof item.author === "object" ? item.author : {};
  const profile = authorObj.profile || {};
  const author = authorObj.displayName || profile.displayName || item.authorDisplayName || authorObj.username || profile.username || item.authorUsername || (typeof item.author === "string" ? item.author : "") || "Автор";
  const authorUsername = authorObj.username || profile.username || item.authorUsername || String(author).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "");
  const responses = item._count?.responses ?? (Array.isArray(item.responses) ? item.responses.length : item.responses ?? 0);
  const meta = item.meta || {};
  return {
    id: item.id,
    slug: item.slug,
    type: item.type,
    title: item.title,
    authorId: authorObj.id || item.authorId,
    author,
    authorUsername,
    authorInitials: initialsFrom(author),
    authorAvatarUrl: authorObj.avatarUrl || profile.avatarUrl || item.authorAvatarUrl || "",
    authorStyle: profile.writingStyle || meta.writingStyle || "атмосферный",
    authorPace: profile.activityLevel || meta.activityExpectation || "спокойный",
    rating: item.ageRating || item.rating || "EVERYONE",
    age: timeAgo(item.publishedAt || item.createdAt),
    body: item.body,
    tags: relationNames(rawTags, "tag"),
    genres: relationNames(item.genres, "genre"),
    fandoms: relationNames(item.fandoms, "fandom"),
    characters: relationNames(item.characters, "character"),
    meta,
    likes: item.likes || 0,
    likedByMe: Boolean(item.likedByMe),
    responses,
    reports: item._count?.reports ?? item.reports ?? 0,
    open: item.status !== "CLOSED",
    status: item.status || "PUBLISHED",
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
    created: item.publishedAt ? Math.max(1, 24 - Math.min(23, Math.round((Date.now() - new Date(item.publishedAt)) / 3_600_000))) : 1
  };
}

function requireAuthForAction(message) {
  if (authSession.accessToken) return true;
  openAuthForCurrentView(message);
  return false;
}

function updateWriteAccessUi() {
  updateListingEditorAuthState();
  updateListingResponseAccessState();
  updateListingResponseState();
  updateListingBlockedState();
  updatePublicProfileBlockedState();
  updatePrivateComposerState();
  updateChatComposerState();
}

function openAuthForCurrentView(message, view = currentViewName()) {
  if (view && view !== "auth") {
    pendingViewAfterAuth = view;
    const currentPath = `${location.pathname}${location.search}${location.hash}`;
    pendingPathAfterAuth = currentViewName() === view && currentPath !== "/auth" ? currentPath : viewPath(view);
  }
  if (message) showToast(message);
  setView("auth");
}

function syncListingLikeState(id, likes, likedByMe) {
  for (const listing of listings) {
    if (String(listing.id) === String(id)) {
      listing.likes = likes;
      listing.likedByMe = likedByMe;
    }
  }
  if (selectedListing && String(selectedListing.id) === String(id)) {
    selectedListing.likes = likes;
    selectedListing.likedByMe = likedByMe;
  }
}

function normalizeBlock(block = {}) {
  const blocked = block.blocked || block.user || {};
  const profile = blocked.profile || block.profile || {};
  const id = block.blockedId || blocked.id || block.userId || block.authorId || block.id || "";
  return {
    ...block,
    blockedId: id,
    blocked: {
      ...blocked,
      id,
      role: blocked.role || block.role || "USER",
      status: blocked.status || block.status || "ACTIVE",
      profile: {
        ...profile,
        displayName: profile.displayName || block.displayName || block.name || profile.username || "",
        username: profile.username || block.username || "",
        avatarUrl: profile.avatarUrl || block.avatarUrl || ""
      }
    }
  };
}

function blockedUserId(block = {}) {
  return block.blockedId || block.blocked?.id || block.userId || block.authorId || block.id || "";
}

function blockedUserIds() {
  return new Set(blocksCache.map((block) => blockedUserId(block)).filter(Boolean).map(String));
}

function isUserBlocked(userId) {
  return Boolean(authSession.accessToken && userId && blockedUserIds().has(String(userId)));
}

function listingIsFromBlockedAuthor(listing = {}) {
  return Boolean(listing?.authorId && isUserBlocked(listing.authorId));
}

function visibleListingsForUser(items = []) {
  return items.filter((item) => !listingIsFromBlockedAuthor(item));
}

function blockEntryFromListing(listing = {}) {
  if (!listing.authorId) return null;
  return {
    blockedId: listing.authorId,
    blocked: {
      id: listing.authorId,
      role: "USER",
      status: "ACTIVE",
      profile: {
        displayName: listing.author || "Автор",
        username: listing.authorUsername || "",
        avatarUrl: listing.authorAvatarUrl || ""
      }
    }
  };
}

function blockEntryFromProfile(profile = {}) {
  const userId = profile.user?.id;
  if (!userId) return null;
  return {
    blockedId: userId,
    blocked: {
      id: userId,
      role: profile.user?.role || "USER",
      status: profile.user?.status || "ACTIVE",
      profile: {
        displayName: profile.displayName || profile.username || "Автор",
        username: profile.username || "",
        avatarUrl: profile.avatarUrl || ""
      }
    }
  };
}

function rememberBlockedUser(entry) {
  if (!entry) return;
  const normalized = normalizeBlock(entry);
  const id = blockedUserId(normalized);
  if (!id) return;
  if (!blocksCache.some((block) => String(blockedUserId(block)) === String(id))) {
    blocksCache = [normalized, ...blocksCache];
  }
  blocksLoaded = true;
  recentListings = recentListings.filter((listing) => String(listing.authorId || "") !== String(id));
  persistRecentListings();
  renderBlocks(blocksCache);
}

function ensureListingBlockNotice() {
  const form = document.querySelector("#listing-response-form");
  let notice = document.querySelector("#listing-block-notice");
  if (!notice && form) {
    notice = document.createElement("div");
    notice.id = "listing-block-notice";
    notice.className = "notice block-notice is-hidden";
    notice.setAttribute("role", "status");
    form.before(notice);
  }
  return notice;
}

function updateListingBlockedState() {
  const authorId = selectedListing?.authorId;
  const blocked = isUserBlocked(authorId);
  const ownListing = Boolean(authorId && authSession.user?.id && String(authorId) === String(authSession.user.id));
  const detail = document.querySelector("#view-listing .listing-detail");
  const blockButton = document.querySelector("#block-author");
  const likeButton = document.querySelector("#like-listing");
  const notice = ensureListingBlockNotice();

  if (detail) detail.classList.toggle("is-author-blocked", blocked);
  if (notice) {
    notice.classList.toggle("is-hidden", !blocked);
    notice.innerHTML = blocked
      ? `<strong>Автор заблокирован</strong><span>Его заявки скрыты из вашей ленты, отклики и личные сообщения с ним недоступны. Управлять блокировками можно в личном кабинете.</span>`
      : "";
  }
  if (blockButton) {
    blockButton.disabled = Boolean(!authorId || ownListing || blocked);
    blockButton.classList.toggle("is-active", blocked);
    blockButton.textContent = ownListing
      ? "Это ваша заявка"
      : blocked
        ? "Автор заблокирован"
        : "Заблокировать автора";
    blockButton.title = blocked
      ? "Автор уже находится в блок-листе"
      : ownListing
        ? "Себя блокировать не нужно"
        : "Скрыть автора из ленты и запретить взаимодействия";
  }
  if (likeButton) {
    likeButton.disabled = blocked;
    likeButton.title = blocked ? "Лайк недоступен для заблокированного автора" : "";
  }
  [
    "#listing-detail-body",
    "#listing-detail-stats",
    "#listing-detail-expectations",
    "#listing-detail-tags",
    "#listing-related-tag",
    "#listing-related-world",
    "#listing-related-list"
  ].forEach((selector) => {
    document.querySelector(selector)?.classList.toggle("is-hidden", blocked);
  });
}

function ensureProfileBlockNotice() {
  const cover = document.querySelector("#public-profile-cover");
  let notice = document.querySelector("#public-profile-block-notice");
  if (!notice && cover) {
    notice = document.createElement("div");
    notice.id = "public-profile-block-notice";
    notice.className = "notice block-notice profile-block-notice is-hidden";
    notice.setAttribute("role", "status");
    const actions = cover.querySelector(".button-row");
    cover.insertBefore(notice, actions || null);
  }
  return notice;
}

function updatePublicProfileBlockedState() {
  const userId = currentPublicProfile?.user?.id;
  const blocked = isUserBlocked(userId);
  const ownProfile = Boolean(userId && authSession.user?.id && String(userId) === String(authSession.user.id));
  const canMessage = currentPublicProfile?.user?.canMessage !== false && currentPublicProfile?.privacy?.allowProfileMessages !== false;
  const cover = document.querySelector("#public-profile-cover");
  const blockButton = document.querySelector("#block-profile-author");
  const messageButton = document.querySelector("#message-profile-author");
  const notice = ensureProfileBlockNotice();

  if (cover) cover.classList.toggle("is-author-blocked", blocked);
  if (notice) {
    notice.classList.toggle("is-hidden", !blocked);
    notice.innerHTML = blocked
      ? `<strong>Автор заблокирован</strong><span>Профиль доступен для просмотра, но заявки и личные сообщения скрыты до разблокировки.</span>`
      : "";
  }
  if (messageButton) {
    messageButton.disabled = Boolean(ownProfile || blocked || !canMessage);
    messageButton.textContent = ownProfile
      ? "Это ваш профиль"
      : blocked
        ? "Автор заблокирован"
        : canMessage ? "Написать" : "ЛС закрыты";
    messageButton.title = blocked
      ? "Разблокируйте автора в личном кабинете, чтобы написать"
      : canMessage ? "Открыть личный диалог" : "Автор отключил новые личные сообщения из профиля";
  }
  if (blockButton) {
    blockButton.disabled = Boolean(!userId || ownProfile || blocked);
    blockButton.classList.toggle("is-active", blocked);
    blockButton.textContent = ownProfile
      ? "Это ваш профиль"
      : blocked
        ? "Автор заблокирован"
        : "Заблокировать автора";
  }
}

function syncBlockedAuthorUi() {
  updateListingBlockedState();
  updatePublicProfileBlockedState();
  renderRecentListings();
  renderHomeListings();
  if (selectedListing) renderRelatedListings(selectedListing);
  renderListings();
  renderLikedListings(likedListingsCache);
  renderPublicProfileListings();
}

function setDrawingPreview(dataUrl) {
  const preview = document.querySelector("#drawing-preview");
  if (!preview) return;
  let image = preview.querySelector("#drawing-preview-image");
  if (!dataUrl) {
    // Remove the preview image entirely so there is never an <img> with empty src.
    if (image) image.remove();
    preview.classList.add("is-hidden");
    updateChatComposerState();
    return;
  }
  if (!image) {
    image = document.createElement("img");
    image.id = "drawing-preview-image";
    image.alt = "Превью рисунка из мини-холста";
    image.decoding = "async";
    preview.prepend(image);
  }
  image.src = dataUrl;
  preview.classList.remove("is-hidden");
  updateChatComposerState();
}

function uploadSizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

function imageDataUrlSize(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  if (!base64) return 0;
  const padding = (base64.match(/=+$/) || [""])[0].length;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function validateImageFile(file, purpose) {
  const label = uploadImageLabels[purpose] || "Изображение";
  if (!uploadImageTypes.has(file.type)) return "Выберите PNG, JPEG или WebP";
  if (file.size > uploadImageSourceLimit) return `${label} должен быть до ${uploadSizeLabel(uploadImageSourceLimit)} до оптимизации`;
  if (file.size < 1) return `${label} пустой`;
  return "";
}

function validateImageDataUrl(dataUrl, purpose) {
  const label = uploadImageLabels[purpose] || "Изображение";
  const limit = uploadImageLimits[purpose] || uploadImageLimits.cover;
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) return "Выберите PNG, JPEG или WebP";
  const size = imageDataUrlSize(dataUrl);
  if (size > limit) return `${label} должен быть до ${uploadSizeLabel(limit)}`;
  if (size < 1) return `${label} пустой`;
  return "";
}

function readImageFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Не удалось прочитать файл")));
    reader.readAsDataURL(file);
  });
}

function loadImageForOptimization(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Не удалось подготовить изображение")), { once: true });
    image.src = dataUrl;
  });
}

async function optimizeImageDataUrl(dataUrl, purpose = "cover") {
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) return dataUrl;
  const options = uploadImageMaxDimensions[purpose] || uploadImageMaxDimensions.cover;
  const limit = uploadImageLimits[purpose] || uploadImageLimits.cover;
  try {
    const image = await loadImageForOptimization(dataUrl);
    const ratio = Math.min(1, options.width / image.naturalWidth, options.height / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return dataUrl;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);
    const candidates = [
      canvas.toDataURL("image/webp", options.quality),
      canvas.toDataURL("image/webp", Math.max(0.62, options.quality - 0.12)),
      canvas.toDataURL("image/jpeg", Math.max(0.68, options.quality - 0.08))
    ].filter((candidate) => /^data:image\/(webp|jpeg);base64,/i.test(candidate));
    candidates.push(dataUrl);
    return candidates
      .filter((candidate) => imageDataUrlSize(candidate) <= limit)
      .sort((a, b) => imageDataUrlSize(a) - imageDataUrlSize(b))[0] || dataUrl;
  } catch {
    return dataUrl;
  }
}

async function prepareImageDataUrl(file, purpose) {
  const original = await readImageFileDataUrl(file);
  const optimized = await optimizeImageDataUrl(original, purpose);
  const validationError = validateImageDataUrl(optimized, purpose);
  if (validationError) throw new Error(validationError);
  if (imageDataUrlSize(optimized) < imageDataUrlSize(original)) {
    showToast(`${uploadImageLabels[purpose] || "Изображение"} оптимизирован до ${uploadSizeLabel(imageDataUrlSize(optimized))}`);
  }
  return optimized;
}

async function uploadImageDataUrl(dataUrl, purpose) {
  const validationError = validateImageDataUrl(dataUrl, purpose);
  if (validationError) throw new Error(validationError);
  return apiFetch("/uploads/images", {
    method: "POST",
    body: JSON.stringify({ dataUrl, purpose })
  });
}

function listingExpectations(listing) {
  const meta = listing.meta || {};
  return [
    meta.postLengthExpectation && `Длина поста: ${meta.postLengthExpectation}`,
    meta.activityExpectation && `Темп: ${meta.activityExpectation}`,
    meta.grammarExpectation && `Грамотность: ${meta.grammarExpectation}`,
    meta.communicationFormat && `Формат связи: ${meta.communicationFormat}`,
    meta.expectedDuration && `Длительность: ${meta.expectedDuration}`,
    meta.collaborationRules,
    meta.hardLimits && `Границы: ${meta.hardLimits}`,
    meta.softPreferences && `Предпочтения: ${meta.softPreferences}`
  ].filter(Boolean);
}

function listingSimilarityScore(source, candidate) {
  if (!source || !candidate || String(source.id) === String(candidate.id)) return 0;
  const sourceTerms = new Set([
    ...(source.tags || []),
    ...(source.genres || []),
    ...(source.fandoms || []),
    ...(source.characters || [])
  ].map((item) => String(item).toLowerCase()));
  const candidateTerms = [
    ...(candidate.tags || []),
    ...(candidate.genres || []),
    ...(candidate.fandoms || []),
    ...(candidate.characters || [])
  ].map((item) => String(item).toLowerCase());
  const shared = candidateTerms.filter((item) => sourceTerms.has(item)).length;
  return shared * 10
    + (source.type === candidate.type ? 4 : 0)
    + (source.rating === candidate.rating ? 2 : 0)
    + (candidate.open ? 1 : 0);
}

function relatedListingCard(listing) {
  const tags = [...new Set([...(listing.tags || []), ...(listing.genres || []), ...(listing.fandoms || []), ...(listing.characters || [])])]
    .slice(0, 3)
    .map((tag) => `<span>${escapeHtml(tag)}</span>`)
    .join("");
  return `
    <article data-open-related-listing="${escapeHtml(listing.id)}" tabindex="0">
      <strong><a href="${escapeHtml(listingHref(listing))}" data-open-related-listing="${escapeHtml(listing.id)}">${escapeHtml(listing.title)}</a></strong>
      <p>${escapeHtml(clipText(stripRichText(listing.body), 96))}</p>
      <div class="tags">${tags}</div>
    </article>
  `;
}

function renderRelatedListings(listing) {
  const box = document.querySelector("#listing-related-list");
  if (!box) return;
  const related = visibleListingsForUser(listings)
    .filter((candidate) => String(candidate.id) !== String(listing.id))
    .map((candidate) => ({ listing: candidate, score: listingSimilarityScore(listing, candidate) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.listing.likes || 0) - (a.listing.likes || 0))
    .slice(0, 3)
    .map((item) => item.listing);
  box.innerHTML = related.length
    ? related.map(relatedListingCard).join("")
    : `<article><strong>Похожие пока не нашлись</strong><p>Откройте ленту с фильтром по тегу или фандому.</p></article>`;
}

function updateListingResponseState() {
  const input = document.querySelector("#listing-response-message");
  const submit = document.querySelector("#listing-response-submit");
  const counter = document.querySelector("#listing-response-counter");
  const note = document.querySelector("#listing-response-note");
  const templateButton = document.querySelector("#fill-response-template");
  const value = input?.value || "";
  const length = richPlainLength(value);
  const storedOk = richWithinStoredLimit(value);
  const listingOpen = Boolean(selectedListing?.open);
  const listingBlocked = isUserBlocked(selectedListing?.authorId);
  const canWrite = Boolean(authSession.accessToken && listingOpen && !listingBlocked && !input?.disabled);
  const textOk = length >= 10 && length <= 4000 && storedOk;
  if (counter) {
    counter.textContent = `${length} / 4000`;
    counter.classList.toggle("is-warning", length > 3600 || !storedOk || (length > 0 && !textOk));
  }
  if (submit) submit.disabled = !(canWrite && textOk);
  if (templateButton) templateButton.disabled = !canWrite;
  if (note) {
    note.textContent = listingBlocked
      ? "Вы заблокировали автора. Чтобы отправить отклик, сначала снимите блокировку в личном кабинете."
      : !listingOpen
        ? "Заявка закрыта, автор может не принять новый отклик."
      : !authSession.accessToken
        ? "Войдите, чтобы написать и отправить отклик."
      : !storedOk
        ? "Форматирования слишком много: сократите текст или очистите часть оформления."
      : !textOk
        ? "Отклик должен быть от 10 до 4000 символов."
        : "Отклик появится у автора в разделе диалогов и откликов.";
  }
  updateRichPreview("listing-response-message");
}

function updateListingResponseAccessState() {
  const input = document.querySelector("#listing-response-message");
  const status = document.querySelector("#listing-response-status");
  const templateButton = document.querySelector("#fill-response-template");
  const listingOpen = Boolean(selectedListing?.open);
  const listingBlocked = isUserBlocked(selectedListing?.authorId);
  const canWrite = Boolean(authSession.accessToken && listingOpen && !listingBlocked);

  if (status) {
    status.textContent = listingBlocked
      ? "Автор заблокирован: отклик отправить нельзя."
      : !authSession.accessToken
        ? "Войдите, чтобы отправить отклик автору."
      : listingOpen
        ? "Отклик увидит автор, а после принятия появится личный диалог."
        : "Заявка закрыта: новый отклик отправить нельзя.";
  }
  if (input) {
    input.disabled = !canWrite;
    input.placeholder = listingBlocked
      ? "Вы заблокировали автора. Разблокируйте его в личном кабинете, чтобы написать отклик."
      : listingOpen
        ? authSession.accessToken
          ? "Расскажите, почему вам подходит эта заявка, какой темп и формат вам удобны."
          : "Войдите, чтобы написать отклик."
        : "Заявка закрыта для новых откликов.";
    updateRichEditorDisabled("listing-response-message");
  }
  if (templateButton) templateButton.disabled = !canWrite;
}

function updateSuggestionFormState() {
  const title = document.querySelector("#suggestion-title-input")?.value.trim() || "";
  const description = document.querySelector("#suggestion-description-input")?.value.trim() || "";
  const source = document.querySelector("#suggestion-source-input")?.value.trim() || "";
  const titleCounter = document.querySelector("#suggestion-title-counter");
  const descriptionCounter = document.querySelector("#suggestion-description-counter");
  const note = document.querySelector("#suggestion-form-note");
  const submit = document.querySelector("#suggestion-submit");
  const titleOk = title.length >= 2 && title.length <= 120;
  const descriptionOk = description.length <= 2000;
  const sourceOk = !source || /^https?:\/\//i.test(source);
  if (titleCounter) {
    titleCounter.textContent = `${title.length} / 120`;
    titleCounter.classList.toggle("is-warning", title.length > 105 || !titleOk);
  }
  if (descriptionCounter) {
    descriptionCounter.textContent = `${description.length} / 2000`;
    descriptionCounter.classList.toggle("is-warning", description.length > 1800 || !descriptionOk);
  }
  if (note) {
    note.textContent = !titleOk
      ? "Название должно быть от 2 до 120 символов."
      : !descriptionOk
        ? "Описание предложения не должно быть длиннее 2000 символов."
        : !sourceOk
          ? "Ссылка на источник должна начинаться с http:// или https://."
          : "Предложение готово к отправке на модерацию.";
  }
  if (submit) submit.disabled = !(titleOk && descriptionOk && sourceOk);
}

function setReportFieldInvalid(field, isInvalid) {
  if (!field) return;
  field.classList.toggle("is-invalid", isInvalid);
  field.setAttribute("aria-invalid", isInvalid ? "true" : "false");
  field.closest("label")?.classList.toggle("is-invalid", isInvalid);
}

function updateReportFormState({ showErrors = false } = {}) {
  const form = document.querySelector("#report-form");
  const idInput = document.querySelector("#report-entity-id");
  const commentInput = document.querySelector("#report-comment");
  const entityId = idInput?.value.trim() || "";
  const comment = commentInput?.value.trim() || "";
  const counter = document.querySelector("#report-comment-counter");
  const note = document.querySelector("#report-form-note");
  const submit = document.querySelector("#report-submit");
  const shouldShowErrors = showErrors || form?.dataset.validationShown === "true";
  const commentOk = !comment || (comment.length >= 3 && comment.length <= 4000);
  setReportFieldInvalid(idInput, shouldShowErrors && !entityId);
  setReportFieldInvalid(commentInput, shouldShowErrors && !commentOk);
  if (counter) {
    counter.textContent = `${comment.length} / 4000`;
    counter.classList.toggle("is-warning", comment.length > 3600 || (comment.length > 0 && !commentOk));
  }
  if (note) {
    note.textContent = !entityId
      ? "Укажите ID объекта, на который отправляется жалоба."
      : !commentOk
        ? "Комментарий должен быть пустым или от 3 до 4000 символов."
        : "Жалоба готова к отправке модераторам.";
  }
  if (submit) submit.disabled = false;
  return entityId && commentOk;
}

function applyReportStateFromQuery(query = "") {
  const params = new URLSearchParams(query);
  const type = params.get("entityType");
  const id = params.get("entityId");
  const reason = params.get("reason");
  const comment = params.get("comment");
  const typeSelect = document.querySelector("#report-entity-type");
  const reasonSelect = document.querySelector("#report-reason");
  if (type && typeSelect && [...typeSelect.options].some((option) => option.value === type)) {
    typeSelect.value = type;
  }
  if (id) document.querySelector("#report-entity-id").value = id;
  if (reason && reasonSelect && [...reasonSelect.options].some((option) => option.value === reason)) {
    reasonSelect.value = reason;
  }
  if (comment) document.querySelector("#report-comment").value = comment.slice(0, 4000);
  updateReportFormState();
}

function openPrefilledReport({ entityType, entityId, comment, authView = "report" }) {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы отправить жалобу, войдите в аккаунт", authView);
    return false;
  }
  const typeSelect = document.querySelector("#report-entity-type");
  const idInput = document.querySelector("#report-entity-id");
  const commentInput = document.querySelector("#report-comment");
  if (typeSelect) typeSelect.value = entityType;
  if (idInput) idInput.value = entityId;
  if (commentInput) commentInput.value = comment || "";
  updateReportFormState();
  setView("report");
  return true;
}

function renderListingDetail(listing) {
  if (!listing) return;
  selectedListing = listing;
  if (!document.querySelector("#listing-title")) return;

  const tags = [...new Set([...(listing.tags || []), ...(listing.genres || []), ...(listing.fandoms || []), ...(listing.characters || [])])];
  const expectations = listingExpectations(listing);
  const title = document.querySelector("#listing-title");
  const kicker = document.querySelector("#listing-detail-kicker");
  const meta = document.querySelector("#listing-detail-meta");
  const body = document.querySelector("#listing-detail-body");
  const expectationList = document.querySelector("#listing-detail-expectations");
  const tagsBox = document.querySelector("#listing-detail-tags");
  const likeButton = document.querySelector("#like-listing");
  const statsBox = document.querySelector("#listing-detail-stats");
  const responseForm = document.querySelector("#listing-response-form");
  const responseSubmit = responseForm?.querySelector("button[type=submit]");

  if (kicker) kicker.textContent = listing.open ? "Открытая заявка Cofind 2" : "Закрытая заявка Cofind 2";
  if (title) title.textContent = listing.title;
  if (meta) {
    meta.innerHTML = `
      <span class="pill">${escapeHtml(listing.type)}</span>
      <span class="pill soft">${escapeHtml(listing.rating)}</span>
      <span>Автор: ${escapeHtml(listing.author)}</span>
      <span>Открыта ${escapeHtml(listing.age)}</span>
      <span>${listing.responses} ${plural(listing.responses, ["отклик", "отклика", "откликов"])}</span>
    `;
  }
  if (body) body.innerHTML = richTextToHtml(listing.body);
  if (statsBox) {
    statsBox.innerHTML = `
      <article><strong>${escapeHtml(listing.likes)}</strong><span>${plural(listing.likes, ["лайк", "лайка", "лайков"])}</span></article>
      <article><strong>${escapeHtml(listing.responses)}</strong><span>${plural(listing.responses, ["отклик", "отклика", "откликов"])}</span></article>
    `;
  }
  if (expectationList) {
    expectationList.innerHTML = expectations.length
      ? expectations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : `<li>Автор пока не заполнил отдельные ожидания. Ориентируйтесь на описание заявки.</li>`;
  }
  if (tagsBox) {
    tagsBox.innerHTML = tags.length
      ? tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")
      : `<span>без тегов</span>`;
  }
  if (likeButton) {
    likeButton.textContent = `${listing.likedByMe ? "♥" : "♡"} ${listing.likes}`;
    likeButton.classList.toggle("is-active", Boolean(listing.likedByMe));
  }
  if (responseSubmit) responseSubmit.disabled = true;
  updateListingResponseAccessState();

  setAvatarElement(document.querySelector("#listing-author-avatar"), listing.author, listing.authorAvatarUrl || "");
  const authorName = document.querySelector("#listing-author-name");
  const authorPace = document.querySelector("#listing-author-pace");
  const authorStyle = document.querySelector("#listing-author-style");
  if (authorName) authorName.textContent = listing.author;
  if (authorPace) authorPace.textContent = `Темп: ${listing.authorPace}`;
  if (authorStyle) authorStyle.textContent = `Стиль: ${listing.authorStyle}`;
  const tagLink = document.querySelector("#listing-related-tag");
  if (tagLink) {
    tagLink.textContent = tags[0] ? `Все заявки по тегу ${tags[0]}` : "Все заявки автора";
    tagLink.href = tags[0] ? `/feed?q=${encodeURIComponent(tags[0])}` : "/feed";
  }
  const worldLink = document.querySelector("#listing-related-world");
  if (worldLink) {
    const world = [...(listing.fandoms || []), ...(listing.characters || [])].slice(0, 2).join(", ");
    worldLink.textContent = world || "Фандомы и персонажи";
    const params = new URLSearchParams();
    if (listing.fandoms?.[0]) params.set("fandom", listing.fandoms[0]);
    else if (listing.characters?.[0]) params.set("character", listing.characters[0]);
    worldLink.href = params.toString() ? `/feed?${params.toString()}` : "/feed";
  }
  updateListingResponseState();
  updateListingBlockedState();
  renderRelatedListings(listing);
  if (currentViewName() === "listing") updateSeo("listing");
}

async function openListing(idOrSlug) {
  if (authSession.accessToken && !blocksLoaded) await loadBlocks();
  const localListing = listings.find((listing) => String(listing.id) === String(idOrSlug) || String(listing.slug) === String(idOrSlug));
  if (localListing) {
    renderListingDetail(localListing);
    rememberRecentListing(localListing);
  }
  const initialUrl = localListing
    ? listingHref(localListing)
    : (idOrSlug ? (isLikelyListingId(idOrSlug) ? `/listing/${encodeURIComponent(idOrSlug)}` : `/listings/${encodeURIComponent(idOrSlug)}`) : "/listing");
  setView("listing", { url: initialUrl });
  if (!apiOnline || !idOrSlug) return;
  try {
    const remote = normalizeListing(await apiFetch(`/listings/${encodeURIComponent(idOrSlug)}`));
    const index = listings.findIndex((listing) => String(listing.id) === String(remote.id));
    if (index >= 0) listings[index] = { ...listings[index], ...remote };
    const listing = index >= 0 ? listings[index] : remote;
    renderListingDetail(listing);
    rememberRecentListing(listing);
    const canonicalUrl = listingHref(listing);
    if (currentViewName() === "listing" && canonicalUrl !== `${location.pathname}`) {
      history.replaceState(history.state, "", canonicalUrl);
      updateSeo("listing");
    }
  } catch {
    showToast("Не удалось обновить заявку из API, показываю данные из ленты");
  }
}

function renderPublicProfile(profile) {
  if (!document.querySelector("#profile-title")) return;
  const displayName = profile.displayName || profile.username || "Автор";
  currentPublicProfile = profile;
  currentProfileUsername = profile.username || null;
  const tags = [
    ...(profile.favoriteGenres || []),
    ...(profile.favoriteFandoms || []),
    ...(profile.favoriteCharacters || []),
    profile.writingStyle,
    profile.literacyLevel,
    profile.preferredPostLength,
    profile.activityLevel,
    profile.communicationPreferences
  ].filter(Boolean);
  const profileListings = (profile.user?.listings || []).map((listing) => normalizeListing({
    ...listing,
    authorDisplayName: displayName,
    authorUsername: profile.username
  }));
  currentPublicProfileListings = profileListings;
  currentPublicProfileListingsTotal = Number(profile.listingsPagination?.total ?? profile.stats?.listings ?? profileListings.length);
  currentPublicProfileListingsTotalPages = Math.max(1, Number(profile.listingsPagination?.totalPages || Math.ceil(currentPublicProfileListingsTotal / publicProfileListingsPageSize) || 1));
  publicProfileListingsPage = Math.max(1, Number(profile.listingsPagination?.page || publicProfileListingsPage || 1));

  setAvatarElement(document.querySelector("#public-profile-avatar"), displayName, profile.avatarUrl || "");
  setCoverElement(document.querySelector("#public-profile-cover"), profile.coverImageUrl || "");
  document.querySelector("#profile-title").textContent = displayName;
  document.querySelector("#public-profile-bio").textContent = profile.bio || "Автор пока не заполнил описание профиля.";
  const blockButton = document.querySelector("#block-profile-author");
  const messageButton = document.querySelector("#message-profile-author");
  if (messageButton) {
    const ownProfile = authSession.user?.id && profile.user?.id === authSession.user.id;
    const canMessage = profile.user?.canMessage !== false && profile.privacy?.allowProfileMessages !== false;
    messageButton.disabled = Boolean(ownProfile || !canMessage);
    messageButton.textContent = ownProfile ? "Это ваш профиль" : canMessage ? "Написать" : "ЛС закрыты";
    messageButton.title = canMessage ? "Открыть личный диалог" : "Автор отключил новые личные сообщения из профиля";
  }
  if (blockButton) {
    const ownProfile = authSession.user?.id && profile.user?.id === authSession.user.id;
    blockButton.disabled = Boolean(ownProfile);
    blockButton.textContent = ownProfile ? "Это ваш профиль" : "Заблокировать автора";
  }
  const reportButton = document.querySelector("#report-profile-author");
  if (reportButton) {
    const ownProfile = authSession.user?.id && profile.user?.id === authSession.user.id;
    reportButton.disabled = Boolean(ownProfile);
    reportButton.textContent = ownProfile ? "Это ваш профиль" : "Пожаловаться";
  }
  updatePublicProfileBlockedState();
  document.querySelector("#public-profile-tags").innerHTML = tags.length
    ? tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")
    : `<span>профиль без тегов</span>`;
  const socialsBox = document.querySelector("#public-profile-socials");
  if (socialsBox) {
    const socialsHtml = renderProfileSocials(profile);
    socialsBox.innerHTML = socialsHtml;
    socialsBox.classList.toggle("is-hidden", !socialsHtml);
  }
  const formatBox = document.querySelector("#public-profile-format");
  if (formatBox) {
    const formatHtml = renderProfileFormat(profile);
    formatBox.innerHTML = formatHtml;
    formatBox.classList.toggle("is-hidden", !formatHtml);
  }
  const stats = profile.stats || {};
  const totalPublishedListings = Number(stats.listings ?? currentPublicProfileListingsTotal ?? profileListings.length);
  const totalLikes = stats.likes ?? profileListings.reduce((sum, listing) => sum + Number(listing.likes || 0), 0);
  const totalResponses = stats.responses ?? profileListings.reduce((sum, listing) => sum + Number(listing.responses || 0), 0);
  document.querySelector("#public-profile-metrics").innerHTML = `
    <article><strong>${escapeHtml(compactNumber(totalPublishedListings))}</strong><span>${plural(totalPublishedListings, ["заявка", "заявки", "заявок"])}</span></article>
    <article><strong>${escapeHtml(compactNumber(totalLikes))}</strong><span>${plural(totalLikes, ["лайк", "лайка", "лайков"])} на заявках</span></article>
    <article><strong>${escapeHtml(compactNumber(totalResponses))}</strong><span>${plural(totalResponses, ["отклик", "отклика", "откликов"])}</span></article>
    <article><strong>${escapeHtml(activityLabel(profile.user?.lastSeenAt))}</strong><span>последняя активность</span></article>
    ${monetizationEnabled() ? `<article><strong>${profile.user?.isPremium ? "да" : "нет"}</strong><span>Premium</span></article>` : ""}
  `;
  const searchInput = document.querySelector("#public-profile-listing-search");
  if (searchInput) searchInput.value = publicProfileListingsQuery;
  const sortSelect = document.querySelector("#public-profile-listing-sort");
  if (sortSelect) sortSelect.value = publicProfileListingsSort;
  renderPublicProfileListings();
  if (currentViewName() === "profile") {
    updateSeo("profile");
    setLinkRel("prev", publicProfileListingsPage > 1 ? `${location.origin}${profileUrl(currentProfileUsername, publicProfileListingsPage - 1, publicProfileListingsQuery, publicProfileListingsSort)}` : null);
    setLinkRel("next", publicProfileListingsPage < currentPublicProfileListingsTotalPages ? `${location.origin}${profileUrl(currentProfileUsername, publicProfileListingsPage + 1, publicProfileListingsQuery, publicProfileListingsSort)}` : null);
  }
}

function renderPublicProfileListings() {
  const box = document.querySelector("#public-profile-listings");
  const countNote = document.querySelector("#public-profile-listings-count");
  const pagination = document.querySelector("#public-profile-listings-pagination");
  if (!box) return;
  if (isUserBlocked(currentPublicProfile?.user?.id)) {
    if (countNote) countNote.textContent = "Автор заблокирован: его заявки скрыты из вашего просмотра.";
    box.innerHTML = `<article class="listing-card"><h2>Автор заблокирован</h2><p>Заявки этого автора скрыты. Управлять блокировками можно в личном кабинете.</p></article>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }
  const search = document.querySelector("#public-profile-listing-search")?.value.trim().toLowerCase() || "";
  const sort = document.querySelector("#public-profile-listing-sort")?.value || "new";
  const filtered = visibleListingsForUser(currentPublicProfileListings)
    .filter((listing) => {
      const haystack = [
        listing.title,
        stripRichText(listing.body),
        ...(listing.tags || []),
        ...(listing.genres || []),
        ...(listing.fandoms || []),
        ...(listing.characters || [])
      ].join(" ").toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => {
      if (sort === "popular") return Number(b.likes || 0) - Number(a.likes || 0);
      if (sort === "responses") return Number(b.responses || 0) - Number(a.responses || 0);
      const aTime = new Date(a.publishedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.publishedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  const totalPages = currentPublicProfileListingsTotalPages;
  publicProfileListingsPage = Math.min(Math.max(1, publicProfileListingsPage), totalPages);
  const pageItems = search ? filtered.slice(0, publicProfileListingsPageSize) : filtered;
  if (countNote) {
    const total = currentPublicProfileListingsTotal || currentPublicProfileListings.length;
    countNote.textContent = search
      ? `Найдено ${total} ${plural(total, ["заявка", "заявки", "заявок"])} автора по запросу. Страница ${publicProfileListingsPage} из ${totalPages}.`
      : `${total} ${plural(total, ["опубликованная заявка", "опубликованные заявки", "опубликованных заявок"])} автора. Страница ${publicProfileListingsPage} из ${totalPages}.`;
  }
  box.innerHTML = pageItems.length
    ? pageItems.map(listingCard).join("")
    : `<article class="listing-card"><h2>${search ? "Ничего не найдено" : "Заявок пока нет"}</h2><p>${search ? "Попробуйте другой запрос по заявкам автора." : "У этого автора нет опубликованных заявок."}</p></article>`;
  if (pagination) {
    if (totalPages <= 1) {
      pagination.innerHTML = "";
    } else {
      const pages = [];
      const start = Math.max(1, publicProfileListingsPage - 2);
      const end = Math.min(totalPages, publicProfileListingsPage + 2);
      if (publicProfileListingsPage > 1) pages.push({ page: publicProfileListingsPage - 1, label: "Назад" });
      for (let page = start; page <= end; page += 1) pages.push({ page, label: String(page), current: page === publicProfileListingsPage });
      if (publicProfileListingsPage < totalPages) pages.push({ page: publicProfileListingsPage + 1, label: "Вперед" });
      pagination.innerHTML = `
        <span>${escapeHtml(publicProfileListingsPage)} / ${escapeHtml(totalPages)}</span>
        ${pages.map((item) => `
          <a href="${escapeHtml(profileUrl(currentProfileUsername, item.page))}" class="${item.current ? "is-current" : ""}" data-profile-listings-page="${escapeHtml(item.page)}" ${item.current ? 'aria-current="page"' : ""}>${escapeHtml(item.label)}</a>
        `).join("")}
      `;
    }
  }
}

function renderMeDashboard({ me, publicProfile, myListings = [], likedListings = [], sentResponses = [], incomingResponses = [], notifications = [], blocks = [] }) {
  if (!document.querySelector("#me-display-name")) return;
  const profile = me.profile || {};
  const displayName = profile.displayName || profile.username || me.email?.split("@")[0] || "Вы";
  selectedAvatarUrl = profile.avatarUrl || "";
  selectedCoverUrl = profile.coverImageUrl || "";
  const tags = [
    ...(profile.favoriteGenres || []),
    ...(profile.favoriteFandoms || []),
    ...(profile.favoriteCharacters || []),
    profile.writingStyle,
    profile.literacyLevel,
    profile.preferredPostLength,
    profile.activityLevel,
    profile.communicationPreferences
  ].filter(Boolean);
  const listingsCount = myListings.length || publicProfile?.user?.listings?.length || 0;
  const responsesCount = sentResponses.length + incomingResponses.length;
  const unreadNotifications = notifications.filter((notification) => !notification.isRead).length;

  setAvatarElement(document.querySelector("#me-avatar"), displayName, selectedAvatarUrl);
  setAvatarElement(document.querySelector("#profile-avatar-preview"), displayName, selectedAvatarUrl);
  setCoverElement(document.querySelector("#me-profile-cover"), selectedCoverUrl);
  setCoverElement(document.querySelector("#profile-cover-preview"), selectedCoverUrl);
  document.querySelector("#me-display-name").textContent = displayName;
  document.querySelector("#me-bio").textContent = profile.bio || "Профиль пока можно наполнить био, стилем письма, любимыми жанрами и темпом.";
  const publicProfileButton = document.querySelector("#open-my-public-profile");
  const copyProfileButton = document.querySelector("#copy-my-profile-link");
  if (publicProfileButton) {
    publicProfileButton.disabled = !profile.username;
    publicProfileButton.title = profile.username ? "Открыть публичный профиль" : "У профиля пока нет username";
  }
  if (copyProfileButton) {
    copyProfileButton.disabled = !profile.username;
    copyProfileButton.title = profile.username ? "Скопировать публичную ссылку" : "У профиля пока нет username";
  }
  document.querySelector("#profile-display-name").value = displayName;
  document.querySelector("#profile-bio").value = profile.bio || "";
  document.querySelector("#profile-avatar-preset").value = selectedAvatarUrl?.startsWith("gradient-") ? selectedAvatarUrl : "";
  document.querySelector("#profile-cover-url").value = selectedCoverUrl && !selectedCoverUrl.startsWith("data:") ? selectedCoverUrl : "";
  document.querySelector("#profile-writing-style").value = profile.writingStyle || "";
  document.querySelector("#profile-literacy-level").value = profile.literacyLevel || "";
  document.querySelector("#profile-post-length").value = profile.preferredPostLength || "";
  document.querySelector("#profile-activity-level").value = profile.activityLevel || "";
  document.querySelector("#profile-communication").value = profile.communicationPreferences || "";
  document.querySelector("#profile-favorite-genres").value = (profile.favoriteGenres || []).join(", ");
  document.querySelector("#profile-favorite-fandoms").value = (profile.favoriteFandoms || []).join(", ");
  document.querySelector("#profile-favorite-characters").value = (profile.favoriteCharacters || []).join(", ");
  const socialLinks = profile.socialLinks || {};
  document.querySelector("#profile-social-website").value = socialLinks.website || "";
  document.querySelector("#profile-social-telegram").value = socialLinks.telegram || "";
  document.querySelector("#profile-social-discord").value = socialLinks.discord || "";
  const privacySettings = profile.privacySettings || {};
  document.querySelector("#profile-show-last-seen").checked = privacySettings.showLastSeen !== false;
  document.querySelector("#profile-allow-messages").checked = privacySettings.allowProfileMessages !== false;
  document.querySelector("#me-tags").innerHTML = tags.length
    ? tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")
    : `<span>${escapeHtml(me.role || "USER")}</span>`;
  const metrics = [
    `<article><strong>${listingsCount}</strong><span>${plural(listingsCount, ["моя заявка", "мои заявки", "моих заявок"])}</span></article>`,
    `<article><strong>${responsesCount}</strong><span>${plural(responsesCount, ["отклик", "отклика", "откликов"])}</span></article>`,
    `<article><strong>${escapeHtml(accountRoleLabel(me.role || "USER"))}</strong><span>роль</span></article>`,
    monetizationEnabled() ? `<article><strong>${me.isPremium ? "да" : "нет"}</strong><span>Premium</span></article>` : "",
    `<article><strong>${unreadNotifications}</strong><span>${plural(unreadNotifications, ["уведомление", "уведомления", "уведомлений"])}</span></article>`
  ].filter(Boolean);
  document.querySelector("#me-metrics").innerHTML = metrics.join("");
  renderAccountRolePanel(me);
  renderProfileReadiness({ profile, me, tags, myListings, sentResponses, incomingResponses });
  renderMyListings(myListings);
  renderLikedListings(likedListings);
  renderNotifications(notifications);
  renderBlocks(blocks);
}

function renderProfileReadiness({ profile = {}, me = {}, tags = [], myListings = [], sentResponses = [], incomingResponses = [] } = {}) {
  const box = document.querySelector("#profile-readiness-list");
  const note = document.querySelector("#profile-readiness-note");
  if (!box) return;
  const socialLinks = profile.socialLinks && typeof profile.socialLinks === "object" && !Array.isArray(profile.socialLinks)
    ? profile.socialLinks
    : {};
  const hasSocialContact = Boolean(socialLinks.website || socialLinks.telegram || socialLinks.discord || profile.communicationPreferences);
  const checks = [
    {
      done: Boolean(profile.avatarUrl),
      title: "Аватар",
      text: "Добавьте preset или небольшую картинку, чтобы вас узнавали в чате и inbox.",
      action: "profile"
    },
    {
      done: Boolean(profile.coverImageUrl),
      title: "Обложка",
      text: "Добавьте обложку, чтобы публичный профиль выглядел завершенным и узнаваемым.",
      action: "profile"
    },
    {
      done: Boolean(profile.bio && profile.bio.trim().length >= 40),
      title: "Био",
      text: "Опишите стиль письма, темп, границы и любимые форматы хотя бы в пару предложений.",
      action: "profile"
    },
    {
      done: tags.length >= 3,
      title: "Творческие метки",
      text: "Заполните жанры, фандомы, персонажей, стиль или темп, чтобы совпадения были точнее.",
      action: "profile"
    },
    {
      done: hasSocialContact,
      title: "Контакты",
      text: "Укажите сайт, Telegram, Discord или формат связи, чтобы партнерам было проще понять, как с вами общаться.",
      action: "profile"
    },
    {
      done: myListings.length > 0,
      title: "Первая заявка",
      text: "Создайте черновик или опубликованную заявку с ожиданиями и каталогами.",
      action: "new-listing"
    },
    {
      done: sentResponses.length + incomingResponses.length > 0,
      title: "Первый контакт",
      text: "Отправьте отклик или примите входящий, чтобы начать личный диалог.",
      action: "inbox"
    }
  ];
  const doneCount = checks.filter((item) => item.done).length;
  const percent = Math.round((doneCount / checks.length) * 100);
  if (note) {
    note.textContent = `${percent}% готовности: ${doneCount} из ${checks.length}.`;
  }
  box.innerHTML = checks.map((item) => `
    <article class="${item.done ? "is-done" : ""}">
      <div>
        <strong>${item.done ? "Готово" : "Нужно"}: ${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.text)}</p>
      </div>
      ${item.done ? `<span class="pill">OK</span>` : `<button type="button" class="ghost-button" data-readiness-action="${escapeHtml(item.action)}">Исправить</button>`}
    </article>
  `).join("");
}

function renderMyListingTabs(items = []) {
  const tabs = document.querySelector("#my-listing-tabs");
  if (!tabs) return;
  const counts = {
    all: items.length,
    DRAFT: items.filter((item) => item.status === "DRAFT").length,
    PUBLISHED: items.filter((item) => item.status === "PUBLISHED").length,
    CLOSED: items.filter((item) => item.status === "CLOSED").length,
    ARCHIVED: items.filter((item) => item.status === "ARCHIVED").length
  };
  const labels = {
    all: "Все",
    DRAFT: "Черновики",
    PUBLISHED: "Опубликованные",
    CLOSED: "Закрытые",
    ARCHIVED: "Архив"
  };
  tabs.querySelectorAll("[data-my-listing-filter]").forEach((button) => {
    const filter = button.dataset.myListingFilter || "all";
    button.classList.toggle("is-active", filter === activeMyListingsFilter);
    button.setAttribute("aria-selected", filter === activeMyListingsFilter ? "true" : "false");
    button.textContent = `${labels[filter] || filter} ${counts[filter] ?? 0}`;
  });
}

function renderMyListings(items = []) {
  myListingsCache = items;
  const box = document.querySelector("#my-listings");
  const countNote = document.querySelector("#my-listings-count");
  if (!box) return;
  renderMyListingTabs(items);
  const search = document.querySelector("#my-listings-search")?.value.trim().toLowerCase() || "";
  const sort = document.querySelector("#my-listings-sort")?.value || "new";
  const statusRank = { DRAFT: 1, PUBLISHED: 2, CLOSED: 3, ARCHIVED: 4, DELETED: 5 };
  const visibleItems = (activeMyListingsFilter === "all"
    ? items
    : items.filter((item) => item.status === activeMyListingsFilter))
    .filter((item) => {
      const listing = normalizeListing(item);
      const haystack = [
        listing.title,
        stripRichText(listing.body),
        listing.status,
        listing.moderationStatus,
        ...(listing.tags || []),
        ...(listing.genres || []),
        ...(listing.fandoms || []),
        ...(listing.characters || [])
      ].join(" ").toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => {
      const left = normalizeListing(a);
      const right = normalizeListing(b);
      if (sort === "responses") return Number(right.responses || 0) - Number(left.responses || 0);
      if (sort === "status") return (statusRank[left.status] || 99) - (statusRank[right.status] || 99);
      if (sort === "title") return left.title.localeCompare(right.title, "ru");
      const aTime = new Date(left.updatedAt || left.publishedAt || left.createdAt || 0).getTime();
      const bTime = new Date(right.updatedAt || right.publishedAt || right.createdAt || 0).getTime();
      return bTime - aTime;
    });
  const emptyText = {
    all: "Создайте первую заявку или продолжите черновик.",
    DRAFT: "Черновиков сейчас нет. Можно создать новую заявку и сохранить ее как черновик.",
    PUBLISHED: "Опубликованных заявок пока нет. Черновик можно отправить на модерацию.",
    CLOSED: "Закрытых заявок пока нет.",
    ARCHIVED: "Архив пуст."
  };
  if (countNote) {
    const totalInFilter = activeMyListingsFilter === "all" ? items.length : items.filter((item) => item.status === activeMyListingsFilter).length;
    countNote.textContent = search
      ? `Найдено ${visibleItems.length} из ${totalInFilter} ${plural(totalInFilter, ["заявка", "заявки", "заявок"])} в текущем фильтре.`
      : `${totalInFilter} ${plural(totalInFilter, ["заявка", "заявки", "заявок"])} в текущем фильтре.`;
  }
  box.innerHTML = visibleItems.length
    ? visibleItems.map((item) => {
        const listing = normalizeListing(item);
        const catalog = [...new Set([...(listing.tags || []), ...(listing.genres || []), ...(listing.fandoms || []), ...(listing.characters || [])])];
        return `
          <article class="listing-card" data-my-listing="${escapeHtml(item.id)}">
            <div class="card-topline">
              <span class="pill ${listing.rating === "ADULT" ? "warm" : ""}">${escapeHtml(listing.status)}</span>
              <span>${escapeHtml(listing.moderationStatus || item.moderationStatus || "PENDING")}</span>
            </div>
            <h2>${escapeHtml(listing.title)}</h2>
            <p>${escapeHtml(clipText(stripRichText(listing.body), 220))}</p>
            <div class="tags">${catalog.slice(0, 8).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
            <footer>
              <span>${escapeHtml(listing.type)} · ${listing.responses} ${plural(listing.responses, ["отклик", "отклика", "откликов"])}</span>
              <div class="button-row">
                <button type="button" class="ghost-button" data-edit-my-listing="${escapeHtml(item.id)}">Редактировать</button>
                <button type="button" class="ghost-button" data-open-my-listing="${escapeHtml(item.id)}">Открыть</button>
                ${item.status !== "PUBLISHED" ? `<button type="button" class="secondary-button" data-publish-my-listing="${escapeHtml(item.id)}">Опубликовать</button>` : ""}
                ${item.status === "PUBLISHED" ? `<button type="button" class="ghost-button" data-close-my-listing="${escapeHtml(item.id)}">Закрыть</button>` : ""}
                ${item.status !== "ARCHIVED" ? `<button type="button" class="ghost-button" data-archive-my-listing="${escapeHtml(item.id)}">Архив</button>` : ""}
                <button type="button" class="ghost-button danger-button" data-delete-my-listing="${escapeHtml(item.id)}">Удалить</button>
              </div>
            </footer>
          </article>
        `;
      }).join("")
    : `<article class="listing-card"><h2>${search ? "Ничего не найдено" : "Заявок пока нет"}</h2><p>${escapeHtml(search ? "Попробуйте другой запрос или смените фильтр статуса." : emptyText[activeMyListingsFilter] || emptyText.all)}</p><div class="button-row"><button type="button" class="secondary-button" data-my-listings-empty-action="new">Создать заявку</button><button type="button" class="ghost-button" data-my-listings-empty-action="all">Показать все</button></div></article>`;
}

function renderLikedListings(items = []) {
  likedListingsCache = items;
  const box = document.querySelector("#liked-listings");
  const countNote = document.querySelector("#liked-listings-count");
  if (!box) return;
  const search = document.querySelector("#liked-listings-search")?.value.trim().toLowerCase() || "";
  const sort = document.querySelector("#liked-listings-sort")?.value || "new";
  const normalizedItems = items
    .map((item) => normalizeListing(item))
    .filter((listing) => !listingIsFromBlockedAuthor(listing));
  const visibleItems = normalizedItems
    .filter((listing) => {
      const haystack = [
        listing.title,
        listing.author,
        listing.authorUsername,
        stripRichText(listing.body),
        ...(listing.tags || []),
        ...(listing.genres || []),
        ...(listing.fandoms || []),
        ...(listing.characters || [])
      ].join(" ").toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => {
      if (sort === "popular") return Number(b.likes || 0) - Number(a.likes || 0);
      if (sort === "responses") return Number(b.responses || 0) - Number(a.responses || 0);
      if (sort === "title") return a.title.localeCompare(b.title, "ru");
      const aTime = new Date(a.publishedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.publishedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  if (countNote) {
    countNote.textContent = search
      ? `Найдено ${visibleItems.length} из ${normalizedItems.length} ${plural(normalizedItems.length, ["заявки", "заявок", "заявок"])}.`
      : `${normalizedItems.length} ${plural(normalizedItems.length, ["понравившаяся заявка", "понравившиеся заявки", "понравившихся заявок"])}.`;
  }
  box.innerHTML = visibleItems.length
    ? visibleItems.map((item) => listingCard(item)).join("")
    : `<article class="listing-card"><h2>${search ? "Ничего не найдено" : "Пока пусто"}</h2><p>${search ? "Попробуйте другой запрос по избранному." : "Лайкните интересную заявку, и она появится здесь."}</p></article>`;
}

function notificationActionLabel(path = "") {
  if (path.includes("inbox")) return "Открыть диалоги";
  if (path.includes("subscription")) return "Открыть подписку";
  if (path.includes("reports")) return "Открыть жалобы";
  if (path.includes("suggestions")) return "Открыть предложения";
  if (path.includes("listing")) return "Открыть заявку";
  if (path.includes("profile")) return "Открыть профиль";
  if (path.includes("admin")) return "Открыть админку";
  return "Открыть";
}

function renderNotificationTabs(notifications = []) {
  const tabs = document.querySelector("#notification-tabs");
  if (!tabs) return;
  const counts = {
    all: notifications.length,
    unread: notifications.filter((notification) => !notification.isRead).length,
    read: notifications.filter((notification) => notification.isRead).length
  };
  const labels = { all: "Все", unread: "Непрочитанные", read: "Прочитанные" };
  tabs.querySelectorAll("[data-notification-filter]").forEach((button) => {
    const filter = button.dataset.notificationFilter || "all";
    button.classList.toggle("is-active", filter === activeNotificationFilter);
    button.setAttribute("aria-selected", filter === activeNotificationFilter ? "true" : "false");
    button.textContent = `${labels[filter] || filter} ${counts[filter] ?? 0}`;
  });
}

function renderNotifications(notifications = []) {
  latestNotifications = notifications;
  updateHeaderNotificationBadge(notifications);
  renderNotificationTabs(notifications);
  const readAllButton = document.querySelector("#read-all-notifications");
  if (readAllButton) readAllButton.disabled = !notifications.some((notification) => !notification.isRead);
  const box = document.querySelector("#notification-list");
  if (!box) return;
  const visibleNotifications = activeNotificationFilter === "unread"
    ? notifications.filter((notification) => !notification.isRead)
    : activeNotificationFilter === "read"
      ? notifications.filter((notification) => notification.isRead)
      : notifications;
  const emptyText = {
    all: "Новые отклики, принятые заявки и системные сообщения появятся здесь.",
    unread: "Непрочитанных уведомлений нет.",
    read: "Прочитанных уведомлений пока нет."
  };
  box.innerHTML = visibleNotifications.length
    ? visibleNotifications.slice(0, 8).map((notification) => `
        <article class="${notification.isRead ? "" : "is-unread"}" data-notification-id="${escapeHtml(notification.id)}">
          <strong>${escapeHtml(notification.title)}</strong>
          <p>${escapeHtml(notification.description || "")}</p>
          <div class="button-row">
            <span class="muted-note">${escapeHtml(timeAgo(notification.createdAt))}</span>
            ${notification.linkPath ? `<button type="button" data-notification-link="${escapeHtml(notification.linkPath)}">${escapeHtml(notificationActionLabel(notification.linkPath))}</button>` : ""}
            ${notification.isRead ? "" : `<button type="button" data-read-notification="${escapeHtml(notification.id)}">Прочитано</button>`}
          </div>
        </article>
      `).join("")
    : `<article><strong>Уведомлений пока нет</strong><p>${escapeHtml(emptyText[activeNotificationFilter] || emptyText.all)}</p><div class="button-row"><button type="button" data-notification-link="/me/inbox">Открыть диалоги</button></div></article>`;
}

function renderBlocks(blocks = []) {
  blocksCache = (Array.isArray(blocks) ? blocks : []).map(normalizeBlock).filter((block) => blockedUserId(block));
  blocksLoaded = Boolean(authSession.accessToken);
  const box = document.querySelector("#block-list");
  const countNote = document.querySelector("#block-list-count");
  if (!box) {
    syncBlockedAuthorUi();
    return;
  }
  const search = document.querySelector("#block-list-search")?.value.trim().toLowerCase() || "";
  const visibleBlocks = blocksCache.filter((block) => {
    const profile = block.blocked?.profile || {};
    const haystack = [
      profile.displayName,
      profile.username,
      blockedUserId(block),
      block.blocked?.role,
      block.blocked?.status
    ].filter(Boolean).join(" ").toLowerCase();
    return !search || haystack.includes(search);
  });
  if (countNote) {
    countNote.textContent = search
      ? `Найдено ${visibleBlocks.length} из ${blocksCache.length} ${plural(blocksCache.length, ["блокировки", "блокировок", "блокировок"])}.`
      : `${blocksCache.length} ${plural(blocksCache.length, ["заблокированный автор", "заблокированных автора", "заблокированных авторов"])}.`;
  }
  box.innerHTML = visibleBlocks.length
    ? visibleBlocks.map((block) => {
        const profile = block.blocked?.profile || {};
        const id = blockedUserId(block);
        const name = profile.displayName || profile.username || id;
        return `
          <article data-blocked-user="${escapeHtml(id)}">
            <div>
              <strong>${escapeHtml(name)}</strong>
              <p>${escapeHtml(block.blocked?.role || "USER")} · ${escapeHtml(block.blocked?.status || "ACTIVE")}</p>
            </div>
            <button type="button" data-unblock-user="${escapeHtml(id)}">Разблокировать</button>
          </article>
        `;
      }).join("")
    : `<article><div><strong>${search ? "Ничего не найдено" : "Список пуст"}</strong><p>${search ? "Попробуйте другой запрос по блок-листу." : "Заблокированные авторы появятся здесь."}</p></div></article>`;
  syncBlockedAuthorUi();
}

function renderMySuggestions(items = []) {
  mySuggestionsCache = items;
  const box = document.querySelector("#my-suggestions");
  const countNote = document.querySelector("#my-suggestions-count");
  if (!box) return;
  const search = document.querySelector("#my-suggestions-search")?.value.trim().toLowerCase() || "";
  const status = document.querySelector("#my-suggestions-status")?.value || "all";
  const visibleItems = items
    .filter((item) => status === "all" || item.status === status)
    .filter((item) => {
      const haystack = [item.type, item.title, item.description, item.status, item.moderatorComment].filter(Boolean).join(" ").toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  if (countNote) {
    countNote.textContent = search || status !== "all"
      ? `Показано ${visibleItems.length} из ${items.length} ${plural(items.length, ["предложения", "предложений", "предложений"])}.`
      : `${items.length} ${plural(items.length, ["предложение", "предложения", "предложений"])} в истории.`;
  }
  box.innerHTML = visibleItems.length
    ? visibleItems.map((item) => `
        <article>
          <strong>${escapeHtml(item.type)}: ${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.status)} · ${escapeHtml(timeAgo(item.createdAt))}${item.moderatorComment ? ` · ${escapeHtml(item.moderatorComment)}` : ""}</p>
        </article>
      `).join("")
    : `<article><strong>${search || status !== "all" ? "Ничего не найдено" : "Пока пусто"}</strong><p>${search || status !== "all" ? "Попробуйте другой запрос или статус." : "После отправки предложения его статус появится здесь."}</p></article>`;
}

async function loadMySuggestions() {
  if (!authSession.accessToken) return;
  try {
    renderMySuggestions(await apiFetch("/suggestions/my"));
  } catch {
    renderMySuggestions([]);
  }
}

function renderMyReports(items = []) {
  myReportsCache = items;
  const box = document.querySelector("#my-reports");
  const countNote = document.querySelector("#my-reports-count");
  if (!box) return;
  const search = document.querySelector("#my-reports-search")?.value.trim().toLowerCase() || "";
  const status = document.querySelector("#my-reports-status")?.value || "all";
  const visibleItems = items
    .filter((item) => status === "all" || item.status === status)
    .filter((item) => {
      const haystack = [item.entityType, item.entityId, item.status, item.reason, item.comment, item.moderatorComment].filter(Boolean).join(" ").toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  if (countNote) {
    countNote.textContent = search || status !== "all"
      ? `Показано ${visibleItems.length} из ${items.length} ${plural(items.length, ["жалобы", "жалоб", "жалоб"])}.`
      : `${items.length} ${plural(items.length, ["жалоба", "жалобы", "жалоб"])} в истории.`;
  }
  box.innerHTML = visibleItems.length
    ? visibleItems.map((item) => `
        <article>
          <strong>${escapeHtml(item.entityType)} ${escapeHtml(String(item.entityId).slice(0, 10))}</strong>
          <p>${escapeHtml(item.status)} · ${escapeHtml(item.reason)} · ${escapeHtml(timeAgo(item.createdAt))}</p>
        </article>
      `).join("")
    : `<article><strong>${search || status !== "all" ? "Ничего не найдено" : "Пока пусто"}</strong><p>${search || status !== "all" ? "Попробуйте другой запрос или статус." : "После отправки жалобы её статус появится здесь."}</p></article>`;
}

async function loadMyReports() {
  if (!authSession.accessToken) return;
  try {
    renderMyReports(await apiFetch("/reports/my"));
  } catch {
    renderMyReports([]);
  }
}

async function openProfile(username, options = {}) {
  if (!username) {
    showToast("У автора нет публичного username");
    return;
  }
  const listingsPage = Math.max(1, Number(options.listingsPage || 1));
  const query = String(options.q ?? "").trim();
  const sort = ["new", "popular", "responses"].includes(options.sort) ? options.sort : "new";
  currentProfileUsername = username;
  publicProfileListingsPage = listingsPage;
  publicProfileListingsQuery = query;
  publicProfileListingsSort = sort;
  setView("profile", {
    updateHistory: options.updateHistory,
    url: options.url || profileUrl(username, listingsPage, query, sort)
  });
  try {
    const params = new URLSearchParams({
      page: String(listingsPage),
      pageSize: String(publicProfileListingsPageSize)
    });
    if (query) params.set("q", query);
    if (sort !== "new") params.set("sort", sort);
    const profile = await apiFetch(`/profiles/${encodeURIComponent(username)}?${params.toString()}`);
    renderPublicProfile(profile);
  } catch {
    if (selectedListing?.authorUsername === username) {
      renderPublicProfile({
        username,
        displayName: selectedListing.author,
        bio: selectedListing.body,
        writingStyle: selectedListing.authorStyle,
        activityLevel: selectedListing.authorPace,
        favoriteGenres: selectedListing.genres,
        favoriteFandoms: selectedListing.fandoms,
        favoriteCharacters: selectedListing.characters,
        user: { role: "USER", status: "ACTIVE", isPremium: false, listings: [selectedListing] }
      });
      showToast("Показываю профиль из данных заявки");
      return;
    }
    showToast("Не удалось загрузить профиль");
  }
}

function normalizeMessage(item) {
  // Public chat is serialized to { author:{id,username,displayName,avatarUrl},
  // staff, reactions:{emoji:count}, quote, drawingUrl, ... }. Keep a fallback for
  // the legacy raw sender/reactions[] shape.
  const authorObj = item.author && typeof item.author === "object" ? item.author : {};
  const senderProfile = item.sender?.profile || {};
  let reactions = {};
  const reactedByMe = {};
  if (Array.isArray(item.reactions)) {
    for (const reaction of item.reactions) {
      reactions[reaction.emoji] = (reactions[reaction.emoji] || 0) + 1;
      if (reaction.userId && reaction.userId === authSession.user?.id) reactedByMe[reaction.emoji] = true;
    }
  } else if (item.reactions && typeof item.reactions === "object") {
    reactions = { ...item.reactions };
  }
  const rawText = item.text || "";
  const roomMatch = rawText.match(/^\[#([a-z0-9-]+)\]\s*/i);
  const room = item.room || (roomMatch ? roomMatch[1].toLowerCase() : "general");
  const visibleText = roomMatch ? rawText.slice(roomMatch[0].length) : rawText;
  const rawQuote = item.quote || item.quotesAsMessage?.[0]?.quotedTextSnapshot || "";
  const quoteMatch = rawQuote.match(/^\[#([a-z0-9-]+)\]\s*/i);
  const senderId = authorObj.id || item.sender?.id || item.senderId || "";
  return {
    id: item.id,
    senderId,
    author: authorObj.displayName || senderProfile.displayName || authorObj.username || senderProfile.username || item.author || "Автор",
    authorUsername: authorObj.username || senderProfile.username || item.authorUsername || "",
    avatarUrl: authorObj.avatarUrl || senderProfile.avatarUrl || item.avatarUrl || "",
    staff: typeof item.staff === "boolean" ? item.staff : ["OWNER", "ADMIN", "MODERATOR"].includes(item.sender?.role || item.role),
    time: item.createdAt ? new Date(item.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : item.time,
    text: visibleText,
    rawText,
    room,
    quote: quoteMatch ? rawQuote.slice(quoteMatch[0].length) : rawQuote,
    reactions,
    reactedByMe: item.reactedByMe || reactedByMe,
    likedByMe: Boolean(item.likedByMe),
    likes: item.likes || 0,
    drawing: normalizeUploadedImageUrl(item.drawingUrl || item.drawings?.[0]?.imageUrl || item.drawing)
  };
}

function renderHomeChat() {
  const box = document.querySelector("#home-live-chat");
  if (!box) return;
  const latest = messages.slice(-3).reverse();
  box.innerHTML = latest.length
    ? latest.map((message) => `
      <article class="home-chat-message" data-open-chat-room="${escapeHtml(message.room || "general")}" tabindex="0">
        ${avatarMarkup(message.author, message.avatarUrl || "")}
        <div>
          <strong>${message.authorUsername ? `<a href="/profile/${encodeURIComponent(message.authorUsername)}" data-open-profile="${escapeHtml(message.authorUsername)}">${escapeHtml(message.author)}</a>` : escapeHtml(message.author)} <span>${escapeHtml(message.time)}</span></strong>
          <p>${escapeHtml(clipText(stripRichText(message.text || "Отправлен рисунок с мини-холста"), 120))}</p>
          ${message.drawing ? `<img class="home-chat-drawing" src="${escapeHtml(message.drawing)}" alt="Рисунок из мини-холста" loading="lazy" decoding="async" />` : ""}
        </div>
      </article>
    `).join("")
    : `<article class="home-chat-message"><div class="avatar">C2</div><div><strong>Чат ждёт первого сообщения</strong><p>Откройте общий чат и начните разговор.</p></div></article>`;
}

async function connectChatSocket() {
  if (!("WebSocket" in window)) return;
  if (chatSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(chatSocket.readyState)) return;
  if (authSession.refreshToken) {
    await refreshAuthSession();
  }
  const token = authSession.accessToken ? `?token=${encodeURIComponent(authSession.accessToken)}` : "";
  chatSocket = new WebSocket(`${WS_BASE}${token}`);
  chatRealtimeState = "connecting";
  setWsStatus(false);
  chatSocket.addEventListener("open", () => {
    chatRealtimeState = "online";
    chatRealtimeCode = null;
    setWsStatus(true);
  });
  chatSocket.addEventListener("close", (event) => {
    chatRealtimeState = "offline";
    chatRealtimeCode = event?.code || null;
    setWsStatus(false);
  });
  chatSocket.addEventListener("error", () => {
    chatRealtimeState = "offline";
    setWsStatus(false);
  });
  chatSocket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "chat.message.created") {
        const normalized = normalizeMessage(message.payload);
        if (!messages.some((item) => String(item.id) === String(normalized.id))) {
          chatAvailability = "ready";
          messages.push(normalized);
          renderMessages();
        }
      }
      if (message.type === "chat.error") {
        showToast("Не удалось отправить сообщение. Проверьте соединение и попробуйте снова.");
      }
    } catch {
      // Ignore non-JSON realtime frames.
    }
  });
}

function renderPlans(plans) {
  const box = document.querySelector("#plans-list");
  if (!box) return;
  if (!monetizationEnabled()) {
    box.innerHTML = `
      <article class="plan">
        <span class="pill soft">Скоро</span>
        <h2>Платные функции скрыты</h2>
        <p>На старте Cofind работает без публичных тарифов. OWNER/ADMIN смогут включить Premium в админке позже.</p>
      </article>
    `;
    return;
  }
  if (!plans?.length) return;
  box.innerHTML = [
    `<article class="plan">
      <span class="pill soft">Free</span>
      <h2>Бесплатный</h2>
      <p>Реклама в ленте, на страницах заявок и в сайдбаре. Базовые настройки внешнего вида.</p>
      <strong>0 ₽</strong>
    </article>`,
    ...plans.map((plan) => `
      <article class="plan featured">
        <span class="pill warm">${plan.code}</span>
        <h2>${plan.name}</h2>
        <p>${plan.description}</p>
        <strong>${Math.round(plan.priceCents / 100)} ${plan.currency} / ${plan.durationDays} дн.</strong>
        <button class="primary-button" data-checkout-plan="${plan.code}">Оформить</button>
      </article>
    `)
  ].join("");
}

function renderSubscriptionStatus(subscription, me = authSession.user) {
  const box = document.querySelector("#subscription-status");
  const cancelButton = document.querySelector("#cancel-subscription");
  if (!box) return;
  if (!monetizationEnabled() || subscription?.enabled === false) {
    if (cancelButton) {
      cancelButton.disabled = true;
      cancelButton.textContent = "Платные функции скрыты";
    }
    box.innerHTML = `
      <span class="pill soft">Не запущено</span>
      <h2>Платные функции пока скрыты</h2>
      <p>На момент запуска Cofind работает без публичных тарифов и оформления подписки. Админ сможет включить этот раздел позже.</p>
    `;
    return;
  }
  const active = Boolean((subscription?.status === "ACTIVE" && subscription?.plan) || me?.isPremium);
  const plan = subscription?.plan;
  const expires = subscription?.expiresAt
    ? new Date(subscription.expiresAt).toLocaleDateString("ru-RU")
    : null;
  if (cancelButton) {
    cancelButton.disabled = !authSession.accessToken || !active;
    cancelButton.textContent = active ? "Отключить Premium" : "Premium не активен";
  }
  box.innerHTML = active
    ? `
      <span class="pill warm">Premium</span>
      <h2>Текущий режим: ${escapeHtml(plan?.name || "Premium")}</h2>
      <p>${expires ? `Активна до ${escapeHtml(expires)}.` : "Premium активен."} Реклама скрыта, расширенные темы доступны.</p>
    `
    : subscription?.status === "CANCELED"
      ? `
        <span class="pill soft">Canceled</span>
        <h2>Premium отключен</h2>
        <p>Подписка отменена${expires ? `, прежний период был до ${escapeHtml(expires)}` : ""}. Можно оформить Premium снова.</p>
      `
    : `
      <span class="pill soft">Free</span>
      <h2>Текущий режим: бесплатный</h2>
      <p>Оформите Premium, чтобы отключить рекламу и открыть расширенные настройки профиля.</p>
    `;
}

function renderPayments(payments = []) {
  paymentsCache = payments;
  const box = document.querySelector("#payment-list");
  const countNote = document.querySelector("#payment-list-count");
  if (!box) return;
  if (!monetizationEnabled()) {
    if (countNote) countNote.textContent = "История платежей скрыта до запуска платных функций.";
    box.innerHTML = `<article><div><strong>Платные функции пока скрыты</strong><p>История платежей появится только после включения Premium администратором.</p></div></article>`;
    return;
  }
  const search = document.querySelector("#payment-search")?.value.trim().toLowerCase() || "";
  const status = document.querySelector("#payment-status-filter")?.value || "all";
  const visiblePayments = payments
    .filter((payment) => status === "all" || payment.status === status)
    .filter((payment) => {
      const haystack = [payment.status, payment.provider, payment.currency, payment.plan?.name, payment.plan?.code, payment.providerPaymentId].filter(Boolean).join(" ").toLowerCase();
      return !search || haystack.includes(search);
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  if (countNote) {
    countNote.textContent = search || status !== "all"
      ? `Показано ${visiblePayments.length} из ${payments.length} ${plural(payments.length, ["платежа", "платежей", "платежей"])}.`
      : `${payments.length} ${plural(payments.length, ["платеж", "платежа", "платежей"])} в истории.`;
  }
  box.innerHTML = visiblePayments.length
    ? visiblePayments.slice(0, 12).map((payment) => {
        const amount = `${Math.round(payment.amountCents / 100)} ${payment.currency}`;
        const date = payment.createdAt ? new Date(payment.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
        return `
          <article>
            <div>
              <strong>${escapeHtml(payment.plan?.name || payment.provider || "Платеж")}</strong>
              <p>${escapeHtml(payment.status)} · ${escapeHtml(date)}</p>
            </div>
            <strong>${escapeHtml(amount)}</strong>
          </article>
        `;
      }).join("")
    : `<article><div><strong>${search || status !== "all" ? "Ничего не найдено" : "Платежей пока нет"}</strong><p>${search || status !== "all" ? "Попробуйте другой запрос или статус." : "История появится после оформления Premium."}</p></div></article>`;
}

async function loadPayments() {
  if (!authSession.accessToken || !monetizationEnabled()) {
    renderPayments([]);
    return;
  }
  try {
    renderPayments(await apiFetch("/me/payments"));
  } catch {
    renderPayments([]);
  }
}

function renderAdSlot(selector, positions) {
  const slot = document.querySelector(selector);
  if (!slot) return;
  const placement = adPlacements.find((ad) => positions.includes(ad.position));
  const hideForPremium = monetizationEnabled() && placement?.target?.hideForPremium && authSession.user?.isPremium;
  if (!placement || hideForPremium) {
    slot.classList.toggle("is-hidden", hideForPremium);
    return;
  }
  slot.classList.remove("is-hidden");
  if (placement.htmlCode) {
    const html = sanitizeAdHtml(placement.htmlCode);
    slot.innerHTML = html ? `<span>Реклама</span>${html}` : `<span>Реклама</span><strong>${escapeHtml(placement.name)}</strong>`;
    return;
  }
  const imageUrl = safeHttpUrl(placement.imageUrl);
  const clickUrl = safeHttpUrl(placement.clickUrl);
  const image = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(placement.name)}" loading="lazy" decoding="async" />` : "";
  const title = clickUrl
    ? `<a href="${escapeHtml(clickUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(placement.name)}</strong></a>`
    : `<strong>${escapeHtml(placement.name)}</strong>`;
  slot.innerHTML = `
    <span>Реклама</span>
    ${image}
    ${title}
    <p>Партнерское размещение помогает развивать площадку.</p>
  `;
}

function renderAds(ads = adPlacements) {
  adPlacements = ads;
  renderAdSlot("#home-ad-slot", ["HOME", "SIDEBAR"]);
  renderAdSlot("#feed-ad-slot", ["FEED", "SIDEBAR"]);
}

function renderCatalogCloud(tags) {
  const cloud = document.querySelector("#catalog-cloud");
  if (!cloud || !tags?.length) return;
  catalogTags = tags;
  cloud.innerHTML = tags
    .slice(0, 12)
    .map((tag) => `<button type="button" data-catalog-tag="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</button>`)
    .join("");
  renderListingTagControls();
}

function renderSelectedCatalogItems({ boxId, datalistId, catalog, selectedSlugs, removeAttribute }) {
  const selectedBox = document.querySelector(boxId);
  const datalist = document.querySelector(datalistId);
  if (datalist) {
    datalist.innerHTML = catalog.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("");
  }
  if (!selectedBox) return;
  selectedBox.innerHTML = selectedSlugs.map((slug) => {
    const item = catalog.find((entry) => entry.slug === slug) || { slug, name: slug };
    return `<span>${escapeHtml(item.name)} <button type="button" ${removeAttribute}="${escapeHtml(slug)}" aria-label="Удалить ${escapeHtml(item.name)}">×</button></span>`;
  }).join("");
}

function selectedCatalogNames(catalog, selectedSlugs) {
  return selectedSlugs.map((slug) => catalog.find((item) => item.slug === slug)?.name || slug);
}

function updateListingPreview() {
  const box = document.querySelector("#listing-form-preview");
  if (!box) return;
  const type = document.querySelector("#listing-type")?.value || "ROLEPLAY_SEARCH";
  const title = document.querySelector("#listing-title-input")?.value.trim() || "Новая творческая заявка";
  const body = document.querySelector("#listing-body-input")?.value.trim() || "Коротко опишите идею, ожидания и удобный темп.";
  const rating = document.querySelector("#listing-rating")?.value || "TEEN";
  const status = document.querySelector("#listing-status")?.value || "DRAFT";
  const tags = [
    ...selectedCatalogNames(catalogTags, selectedListingTagSlugs),
    ...selectedCatalogNames(catalogGenres, selectedListingGenreSlugs),
    ...selectedCatalogNames(catalogFandoms, selectedListingFandomSlugs),
    ...selectedCatalogNames(catalogCharacters, selectedListingCharacterSlugs)
  ];
  box.innerHTML = `
    <div class="card-topline">
      <span class="pill ${rating === "ADULT" ? "warm" : ""}">${escapeHtml(type)}</span>
      <span>${escapeHtml(status === "PUBLISHED" ? "к публикации" : "черновик")}</span>
    </div>
    <h2>${escapeHtml(title)}</h2>
    ${richTextToHtml(body)}
    <div class="tags">${tags.slice(0, 10).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") || "<span>без тегов</span>"}</div>
  `;
  updateListingFormState();
}

function updateListingFormState() {
  const titleInput = document.querySelector("#listing-title-input");
  const bodyInput = document.querySelector("#listing-body-input");
  const titleCounter = document.querySelector("#listing-title-counter");
  const bodyCounter = document.querySelector("#listing-body-counter");
  const note = document.querySelector("#listing-form-note");
  const submit = document.querySelector("#listing-submit");
  const canWrite = Boolean(authSession.accessToken);
  const titleLength = titleInput?.value.trim().length || 0;
  const bodyValue = bodyInput?.value || "";
  const bodyLength = richPlainLength(bodyValue);
  const bodyStoredOk = richWithinStoredLimit(bodyValue);
  const titleOk = titleLength >= 6 && titleLength <= 140;
  const bodyOk = bodyLength >= 20 && bodyLength <= 4000 && bodyStoredOk;
  if (titleCounter) {
    titleCounter.textContent = `${titleLength} / 140`;
    titleCounter.classList.toggle("is-warning", titleLength > 125 || !titleOk);
  }
  if (bodyCounter) {
    bodyCounter.textContent = `${bodyLength} / 4000`;
    bodyCounter.classList.toggle("is-warning", bodyLength > 3600 || !bodyStoredOk || !bodyOk);
  }
  if (note) {
    note.textContent = !canWrite
      ? "Войдите, чтобы создавать и редактировать заявки."
      : !titleOk
      ? "Заголовок должен быть от 6 до 140 символов."
      : !bodyStoredOk
        ? "Форматирования слишком много: сократите текст или очистите часть оформления."
      : !bodyOk
        ? "Описание должно быть от 20 до 4000 символов."
        : editingListingId
          ? "Можно сохранить изменения существующей заявки."
          : "Можно сохранить заявку или продолжить черновик позже.";
  }
  if (submit) submit.disabled = !(canWrite && titleOk && bodyOk);
}

function updateListingEditorAuthState() {
  const form = document.querySelector("#listing-form");
  if (!form) return;
  const locked = !authSession.accessToken;
  form.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = locked;
  });
  updateRichEditorDisabled("listing-body-input");
  updateListingFormState();
}

function renderListingTagControls() {
  renderSelectedCatalogItems({
    boxId: "#listing-selected-tags",
    datalistId: "#tag-options",
    catalog: catalogTags,
    selectedSlugs: selectedListingTagSlugs,
    removeAttribute: "data-remove-listing-tag"
  });
  renderSelectedCatalogItems({
    boxId: "#listing-selected-genres",
    datalistId: "#genre-options",
    catalog: catalogGenres,
    selectedSlugs: selectedListingGenreSlugs,
    removeAttribute: "data-remove-listing-genre"
  });
  renderSelectedCatalogItems({
    boxId: "#listing-selected-fandoms",
    datalistId: "#fandom-options",
    catalog: catalogFandoms,
    selectedSlugs: selectedListingFandomSlugs,
    removeAttribute: "data-remove-listing-fandom"
  });
  renderSelectedCatalogItems({
    boxId: "#listing-selected-characters",
    datalistId: "#character-options",
    catalog: catalogCharacters,
    selectedSlugs: selectedListingCharacterSlugs,
    removeAttribute: "data-remove-listing-character"
  });
  updateListingPreview();
}

function updateListingDraftStatus(message = "") {
  const status = document.querySelector("#listing-draft-status");
  if (!status) return;
  status.textContent = message || "Черновик новой заявки сохраняется локально в браузере.";
}

function listingDraftPayload() {
  return {
    type: document.querySelector("#listing-type")?.value || "ROLEPLAY_SEARCH",
    title: document.querySelector("#listing-title-input")?.value.trim() || "",
    body: document.querySelector("#listing-body-input")?.value.trim() || "",
    ageRating: document.querySelector("#listing-rating")?.value || "TEEN",
    status: document.querySelector("#listing-status")?.value || "DRAFT",
    tagSlugs: selectedListingTagSlugs,
    genreSlugs: selectedListingGenreSlugs,
    fandomSlugs: selectedListingFandomSlugs,
    characterSlugs: selectedListingCharacterSlugs,
    savedAt: new Date().toISOString()
  };
}

function hasListingDraftContent(draft) {
  return Boolean(
    draft?.title ||
    draft?.body ||
    draft?.tagSlugs?.length ||
    draft?.genreSlugs?.length ||
    draft?.fandomSlugs?.length ||
    draft?.characterSlugs?.length
  );
}

function saveListingDraft() {
  if (editingListingId || restoringListingDraft) return;
  try {
    const draft = listingDraftPayload();
    if (!hasListingDraftContent(draft)) {
      localStorage.removeItem(listingDraftKey);
      updateListingDraftStatus();
      return;
    }
    localStorage.setItem(listingDraftKey, JSON.stringify(draft));
    updateListingDraftStatus(`Черновик сохранен ${new Date(draft.savedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}.`);
  } catch {
    updateListingDraftStatus("Не удалось сохранить локальный черновик. Проверьте настройки браузера.");
  }
}

function scheduleListingDraftSave() {
  if (editingListingId || restoringListingDraft) return;
  window.clearTimeout(listingDraftTimer);
  listingDraftTimer = window.setTimeout(saveListingDraft, 350);
}

function clearListingDraft() {
  window.clearTimeout(listingDraftTimer);
  localStorage.removeItem(listingDraftKey);
  updateListingDraftStatus("Черновик очищен после сохранения заявки.");
}

function restoreListingDraft() {
  const form = document.querySelector("#listing-form");
  if (!form || editingListingId) return false;
  const raw = localStorage.getItem(listingDraftKey);
  if (!raw) {
    updateListingDraftStatus();
    return false;
  }
  try {
    const draft = JSON.parse(raw);
    if (!hasListingDraftContent(draft)) {
      clearListingDraft();
      return false;
    }
    restoringListingDraft = true;
    document.querySelector("#listing-type").value = draft.type || "ROLEPLAY_SEARCH";
    document.querySelector("#listing-title-input").value = draft.title || "";
    document.querySelector("#listing-body-input").value = draft.body || "";
    syncRichEditorFromTextarea("listing-body-input");
    document.querySelector("#listing-rating").value = draft.ageRating || "TEEN";
    document.querySelector("#listing-status").value = draft.status || "DRAFT";
    selectedListingTagSlugs = Array.isArray(draft.tagSlugs) ? draft.tagSlugs : [];
    selectedListingGenreSlugs = Array.isArray(draft.genreSlugs) ? draft.genreSlugs : [];
    selectedListingFandomSlugs = Array.isArray(draft.fandomSlugs) ? draft.fandomSlugs : [];
    selectedListingCharacterSlugs = Array.isArray(draft.characterSlugs) ? draft.characterSlugs : [];
    renderListingTagControls();
    const savedAt = draft.savedAt ? new Date(draft.savedAt) : null;
    const savedTime = savedAt && !Number.isNaN(savedAt.getTime())
      ? savedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
      : "";
    updateListingDraftStatus(savedTime ? `Восстановлен локальный черновик от ${savedTime}.` : "Восстановлен локальный черновик.");
    return true;
  } catch {
    localStorage.removeItem(listingDraftKey);
    updateListingDraftStatus("Поврежденный локальный черновик удален.");
    return false;
  } finally {
    restoringListingDraft = false;
  }
}

function resetListingEditor({ restoreDraft = true } = {}) {
  editingListingId = null;
  const form = document.querySelector("#listing-form");
  form?.reset();
  selectedListingTagSlugs = ["slow-burn", "oc"].filter((slug) => catalogTags.some((tag) => tag.slug === slug));
  selectedListingGenreSlugs = [];
  selectedListingFandomSlugs = [];
  selectedListingCharacterSlugs = [];
  const submit = document.querySelector("#listing-form button[type=submit]");
  if (submit) submit.textContent = "Сохранить заявку";
  renderListingTagControls();
  if (restoreDraft) restoreListingDraft();
  else updateListingDraftStatus();
  syncRichEditorFromTextarea("listing-body-input");
}

function editListingInForm(item) {
  editingListingId = item.id;
  document.querySelector("#listing-type").value = item.type || "COAUTHOR_SEARCH";
  document.querySelector("#listing-title-input").value = item.title || "";
  document.querySelector("#listing-body-input").value = item.body || "";
  syncRichEditorFromTextarea("listing-body-input");
  document.querySelector("#listing-rating").value = item.ageRating || "TEEN";
  document.querySelector("#listing-status").value = item.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";
  selectedListingTagSlugs = relationSlugs(item.tags, "tag");
  selectedListingGenreSlugs = relationSlugs(item.genres, "genre");
  selectedListingFandomSlugs = relationSlugs(item.fandoms, "fandom");
  selectedListingCharacterSlugs = relationSlugs(item.characters, "character");
  const submit = document.querySelector("#listing-form button[type=submit]");
  if (submit) submit.textContent = "Сохранить изменения";
  renderListingTagControls();
  updateListingDraftStatus("Редактируете существующую заявку. Локальный черновик новой заявки не перезаписывается.");
  setView("new-listing");
}

function renderFeedCatalogFilters() {
  const configs = [
    { selector: "#feed-genre", items: catalogGenres, label: "Любой жанр" },
    { selector: "#feed-fandom", items: catalogFandoms, label: "Любой фандом" },
    { selector: "#feed-character", items: catalogCharacters, label: "Любой персонаж" }
  ];
  configs.forEach(({ selector, items, label }) => {
    const select = document.querySelector(selector);
    if (!select) return;
    const previous = select.dataset.pendingValue || select.value;
    select.innerHTML = `<option value="all">${label}</option>${items.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("")}`;
    if (previous && previous !== "all" && ![...select.options].some((option) => option.value === previous)) {
      select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(previous)}">${escapeHtml(previous)}</option>`);
    }
    select.value = previous || "all";
    delete select.dataset.pendingValue;
  });
}

function feedControls() {
  return {
    search: document.querySelector("#feed-search"),
    type: document.querySelector("#feed-type"),
    rating: document.querySelector("#feed-rating"),
    genre: document.querySelector("#feed-genre"),
    fandom: document.querySelector("#feed-fandom"),
    character: document.querySelector("#feed-character"),
    open: document.querySelector("#feed-open"),
    recent: document.querySelector("#feed-new")
  };
}

function setSelectValue(selector, value, fallback = "all") {
  const select = document.querySelector(selector);
  if (!select) return;
  const target = value || fallback;
  const option = [...select.options].find((item) => item.value === target || normalizeSearchText(item.value) === normalizeSearchText(target));
  if (target !== fallback && !option) {
    select.dataset.pendingValue = target;
    select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(target)}">${escapeHtml(target)}</option>`);
  }
  select.value = option ? option.value : [...select.options].some((item) => item.value === target) ? target : fallback;
}

function setFeedSort(sort = "new") {
  activeSort = ["new", "popular", "unanswered"].includes(sort) ? sort : "new";
  document.querySelectorAll("[data-sort]").forEach((item) => {
    item.classList.toggle("is-selected", item.dataset.sort === activeSort);
  });
}

function feedStatePayload() {
  const controls = feedControls();
  return {
    q: controls.search?.value.trim() || "",
    type: controls.type?.value || "all",
    ageRating: controls.rating?.value || "all",
    genre: controls.genre?.value || "all",
    fandom: controls.fandom?.value || "all",
    character: controls.character?.value || "all",
    open: controls.open ? controls.open.checked : false,
    recent: controls.recent ? controls.recent.checked : false,
    sort: activeSort,
    savedAt: new Date().toISOString()
  };
}

function hasFeedState(state) {
  return Boolean(
    state?.q ||
    (state?.type && state.type !== "all") ||
    (state?.ageRating && state.ageRating !== "all") ||
    (state?.genre && state.genre !== "all") ||
    (state?.fandom && state.fandom !== "all") ||
    (state?.character && state.character !== "all") ||
    state?.open === true ||
    state?.recent === true ||
    (state?.sort && state.sort !== "new")
  );
}

function updateFeedFilterStatus(message = "") {
  const status = document.querySelector("#feed-filter-status");
  if (!status) return;
  status.textContent = message || "Фильтры можно сохранить в этом браузере.";
}

function setFeedBusy(isBusy, message = "") {
  const list = document.querySelector("#listing-list");
  if (list) {
    if (isBusy) list.setAttribute("aria-busy", "true");
    else list.removeAttribute("aria-busy");
  }
  if (message) updateFeedFilterStatus(message);
}

function applyFeedStatePayload(state = {}) {
  const controls = feedControls();
  if (controls.search) controls.search.value = state.q || "";
  setSelectValue("#feed-type", state.type || "all");
  setSelectValue("#feed-rating", state.ageRating || "all");
  setSelectValue("#feed-genre", state.genre || "all");
  setSelectValue("#feed-fandom", state.fandom || "all");
  setSelectValue("#feed-character", state.character || "all");
  if (controls.open) controls.open.checked = Boolean(state.open);
  if (controls.recent) controls.recent.checked = Boolean(state.recent);
  setFeedSort(state.sort || "new");
}

function persistFeedFilters({ silent = false } = {}) {
  const state = feedStatePayload();
  if (!hasFeedState(state)) {
    localStorage.removeItem(feedFiltersKey);
    if (!silent) updateFeedFilterStatus("Фильтры сброшены к состоянию по умолчанию.");
    return;
  }
  localStorage.setItem(feedFiltersKey, JSON.stringify(state));
  if (!silent) {
    updateFeedFilterStatus(`Фильтры сохранены ${new Date(state.savedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}.`);
  }
}

function restoreFeedFilters() {
  if (location.pathname === "/feed" && location.search) return false;
  try {
    const raw = localStorage.getItem(feedFiltersKey);
    if (!raw) {
      updateFeedFilterStatus();
      return false;
    }
    const state = JSON.parse(raw);
    if (!hasFeedState(state)) {
      localStorage.removeItem(feedFiltersKey);
      updateFeedFilterStatus();
      return false;
    }
    applyFeedStatePayload(state);
    updateFeedFilterStatus("Восстановлены сохраненные фильтры ленты.");
    return true;
  } catch {
    localStorage.removeItem(feedFiltersKey);
    updateFeedFilterStatus("Поврежденные сохраненные фильтры удалены.");
    return false;
  }
}

function resetFeedFilters({ updateUrl = true } = {}) {
  const controls = feedControls();
  if (controls.search) controls.search.value = "";
  setSelectValue("#feed-type", "all");
  setSelectValue("#feed-rating", "all");
  setSelectValue("#feed-genre", "all");
  setSelectValue("#feed-fandom", "all");
  setSelectValue("#feed-character", "all");
  if (controls.open) controls.open.checked = false;
  if (controls.recent) controls.recent.checked = false;
  setFeedSort("new");
  feedPage = 1;
  localStorage.removeItem(feedFiltersKey);
  updateFeedFilterStatus("Фильтры сброшены.");
  if (updateUrl && currentViewName() === "feed") {
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (currentUrl !== "/feed") history.pushState({ view: "feed", page: 1 }, "", "/feed");
    updateSeo("feed");
  }
  if (apiOnline) refreshFeedFromApi();
  else renderListings();
}

function removeFeedFilter(key) {
  const controls = feedControls();
  if (key === "q" && controls.search) controls.search.value = "";
  if (key === "type") setSelectValue("#feed-type", "all");
  if (key === "ageRating") setSelectValue("#feed-rating", "all");
  if (key === "genre") setSelectValue("#feed-genre", "all");
  if (key === "fandom") setSelectValue("#feed-fandom", "all");
  if (key === "character") setSelectValue("#feed-character", "all");
  if (key === "open" && controls.open) controls.open.checked = false;
  if (key === "recent" && controls.recent) controls.recent.checked = false;
  if (key === "sort") setFeedSort("new");
  feedPage = 1;
  scheduleFeedRefresh();
}

function setSelectIfOption(selector, value) {
  const select = document.querySelector(selector);
  if (!select || !value) return false;
  const normalized = normalizeSearchText(value);
  const option = [...select.options].find((item) => (
    item.value === value ||
    item.textContent === value ||
    normalizeSearchText(item.value) === normalized ||
    normalizeSearchText(item.textContent) === normalized
  ));
  if (!option) return false;
  select.value = option.value;
  return true;
}

function applyRelatedListingFilter(kind) {
  if (!selectedListing) return;
  const search = document.querySelector("#feed-search");
  const genreSelect = document.querySelector("#feed-genre");
  const fandomSelect = document.querySelector("#feed-fandom");
  const characterSelect = document.querySelector("#feed-character");
  if (search) search.value = "";
  if (genreSelect) genreSelect.value = "all";
  if (fandomSelect) fandomSelect.value = "all";
  if (characterSelect) characterSelect.value = "all";

  if (kind === "tag") {
    const tag = [...(selectedListing.tags || []), ...(selectedListing.genres || [])][0];
    if (tag && !setSelectIfOption("#feed-genre", tag) && search) search.value = tag;
  } else {
    const fandom = selectedListing.fandoms?.[0];
    const character = selectedListing.characters?.[0];
    if (fandom && !setSelectIfOption("#feed-fandom", fandom) && search) search.value = fandom;
    else if (character && !setSelectIfOption("#feed-character", character) && search) search.value = character;
  }

  feedPage = 1;
  setView("feed", { url: feedUrlForPage(1) });
  if (apiOnline) refreshFeedFromApi();
  else renderListings();
}

function findCatalogItem(catalog, value) {
  const normalized = normalizeSearchText(value);
  return catalog.find((item) => normalizeSearchText(item.slug) === normalized || normalizeSearchText(item.name) === normalized);
}

function findCatalogTag(value) {
  return findCatalogItem(catalogTags, value);
}

function feedQueryString() {
  const params = new URLSearchParams();
  const controls = feedControls();
  const q = controls.search?.value.trim();
  const type = controls.type?.value;
  const ageRating = controls.rating?.value;
  const genre = controls.genre?.value;
  const fandom = controls.fandom?.value;
  const character = controls.character?.value;
  if (q) params.set("q", q);
  if (type && type !== "all") params.set("type", type);
  if (ageRating && ageRating !== "all") params.set("ageRating", ageRating);
  if (genre && genre !== "all") params.set("genre", genre);
  if (fandom && fandom !== "all") params.set("fandom", fandom);
  if (character && character !== "all") params.set("character", character);
  if (activeSort !== "new") params.set("sort", activeSort);
  params.set("page", String(feedPage));
  params.set("pageSize", String(feedPageSize));
  return params.toString();
}

function feedUrlForPage(page = feedPage) {
  const params = new URLSearchParams();
  const controls = feedControls();
  const q = controls.search?.value.trim();
  const type = controls.type?.value;
  const ageRating = controls.rating?.value;
  const genre = controls.genre?.value;
  const fandom = controls.fandom?.value;
  const character = controls.character?.value;
  if (q) params.set("q", q);
  if (type && type !== "all") params.set("type", type);
  if (ageRating && ageRating !== "all") params.set("ageRating", ageRating);
  if (genre && genre !== "all") params.set("genre", genre);
  if (fandom && fandom !== "all") params.set("fandom", fandom);
  if (character && character !== "all") params.set("character", character);
  if (controls.open?.checked) params.set("open", "1");
  if (controls.recent?.checked) params.set("new", "1");
  if (activeSort !== "new") params.set("sort", activeSort);
  if (Number(page) > 1) params.set("page", String(Math.max(1, Number(page || 1))));
  const query = params.toString();
  return query ? `/feed?${query}` : "/feed";
}

function inboxUrl(conversationId = activePrivateConversationId, filter = activeInboxFilter) {
  const params = new URLSearchParams();
  if (conversationId) params.set("conversation", conversationId);
  if (filter && filter !== "all") params.set("tab", filter);
  const query = params.toString();
  return query ? `/me/inbox?${query}` : "/me/inbox";
}

function applyInboxStateFromQuery(query = "") {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  activePrivateConversationId = params.get("conversation") || activePrivateConversationId;
  const tab = params.get("tab") || "all";
  activeInboxFilter = ["all", "new", "sent", "dialogs"].includes(tab) ? tab : "all";
}

function syncFeedUrl({ replace = true } = {}) {
  if (currentViewName() !== "feed") return;
  const targetUrl = feedUrlForPage(feedPage);
  const currentUrl = `${location.pathname}${location.search}${location.hash}`;
  if (currentUrl !== targetUrl) history[replace ? "replaceState" : "pushState"]({ view: "feed", page: feedPage }, "", targetUrl);
  updateSeo("feed");
}

function applyFeedStateFromQuery(query = "") {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  applyFeedStatePayload({
    q: params.get("q") || "",
    type: params.get("type") || "all",
    ageRating: params.get("ageRating") || params.get("rating") || "all",
    genre: params.get("genre") || "all",
    fandom: params.get("fandom") || "all",
    character: params.get("character") || "all",
    open: params.get("open") === "1" || params.get("open") === "true",
    recent: params.get("new") === "1",
    sort: params.get("sort") || "new"
  });
  const controls = feedControls();
  if (controls.open) controls.open.checked = params.get("open") === "1" || params.get("open") === "true";
  if (controls.recent) controls.recent.checked = params.get("new") === "1";
  feedPage = Math.max(1, Number(params.get("page") || 1));
  updateFeedFilterStatus(params.toString() ? "Фильтры применены из URL." : "");
}

function goToFeedPage(page, updateUrl = true) {
  feedPage = Math.max(1, Number(page || 1));
  setView("feed", { updateHistory: false });
  if (updateUrl) {
    const targetUrl = feedUrlForPage(feedPage);
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (currentUrl !== targetUrl) history.pushState({ view: "feed", page: feedPage }, "", targetUrl);
  }
  if (apiOnline) refreshFeedFromApi();
  else renderListings();
}

// Accepts both the paginated listing envelope ({items,total,page,pageSize,
// totalPages,nextPage}) and the search/legacy shapes ({hits,pagination} | array).
function normalizeListingEnvelope(result) {
  if (!result) return { items: [], pagination: null };
  if (Array.isArray(result)) return { items: result, pagination: null };
  const items = result.items || result.hits || [];
  let pagination = result.pagination || null;
  if (!pagination && (result.total !== undefined || result.page !== undefined)) {
    pagination = {
      page: result.page || 1,
      pageSize: result.pageSize || items.length || feedPageSize,
      total: result.total ?? items.length,
      totalPages: result.totalPages || 1
    };
  }
  return { items, pagination };
}

async function refreshFeedFromApi() {
  if (authSession.accessToken && !blocksLoaded) await loadBlocks();
  if (!apiOnline) {
    renderListings();
    return;
  }
  setFeedBusy(true, "Лента обновляется...");
  try {
    const query = feedQueryString();
    const result = await apiFetch(`/search/listings${query ? `?${query}` : ""}`);
    const envelope = normalizeListingEnvelope(result);
    listings = envelope.items.map(normalizeListing);
    feedApiLoaded = true;
    feedServerPagination = envelope.pagination;
    if (feedServerPagination) feedPage = feedServerPagination.page || feedPage;
    renderListings();
    setFeedBusy(false, "Лента обновлена.");
  } catch (error) {
    feedServerPagination = null;
    setApiStatus(false, "Сервис временно недоступен");
    renderListings();
    setFeedBusy(false, apiFailure("Не удалось обновить ленту. Показываем сохраненные заявки", error));
  }
}

function scheduleFeedRefresh(resetPage = true) {
  if (resetPage) feedPage = 1;
  persistFeedFilters({ silent: true });
  syncFeedUrl();
  window.clearTimeout(feedSearchTimer);
  feedSearchTimer = window.setTimeout(refreshFeedFromApi, 350);
}

function renderInboxTabs({ incomingResponses = [], sentResponses = [], conversations = [] } = {}) {
  const tabs = document.querySelector("#inbox-tabs");
  if (!tabs) return;
  const counts = {
    all: incomingResponses.length + sentResponses.length + conversations.length,
    new: incomingResponses.filter((response) => response.status === "NEW").length,
    sent: sentResponses.length,
    dialogs: conversations.length
  };
  tabs.querySelectorAll("[data-inbox-filter]").forEach((button) => {
    const filter = button.dataset.inboxFilter || "all";
    button.classList.toggle("is-active", filter === activeInboxFilter);
    button.setAttribute("aria-selected", filter === activeInboxFilter ? "true" : "false");
    const label = button.textContent.replace(/\s*\d+$/, "");
    button.textContent = `${label} ${counts[filter] ?? 0}`;
  });
}

function setInboxFilter(filter = "all", { updateUrl = true } = {}) {
  activeInboxFilter = ["all", "new", "sent", "dialogs"].includes(filter) ? filter : "all";
  if (activeInboxFilter !== "dialogs") activePrivateConversationId = null;
  renderInbox(inboxPayload);
  if (updateUrl && currentViewName() === "inbox") {
    const targetUrl = inboxUrl(activeInboxFilter === "dialogs" ? activePrivateConversationId : null, activeInboxFilter);
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (currentUrl !== targetUrl) history.pushState({ view: "inbox", tab: activeInboxFilter }, "", targetUrl);
    updateSeo("inbox");
  }
}

function renderInbox(data = {}) {
  const box = document.querySelector("#inbox-list");
  if (!box) return;
  const search = document.querySelector("#inbox-search")?.value.trim().toLowerCase() || "";
  const sort = document.querySelector("#inbox-sort")?.value || "new";
  const countNote = document.querySelector("#inbox-list-count");
  const conversations = Array.isArray(data) ? data : data.conversations || [];
  const incomingResponses = Array.isArray(data.incomingResponses) ? data.incomingResponses : [];
  const sentResponses = Array.isArray(data.sentResponses) ? data.sentResponses : [];
  inboxConversations = conversations;
  renderInboxTabs({ incomingResponses, sentResponses, conversations });
  const newIncomingCount = incomingResponses.filter((response) => response.status === "NEW").length;
  const acceptedSentCount = sentResponses.filter((response) => response.status === "ACCEPTED").length;
  const unreadCount = conversations.reduce((sum, conversation) => sum + Number(conversation.unreadCount || 0), 0);
  headerInboxUnreadCount = unreadCount;
  updateHeaderNotificationBadge();
  const summary = document.querySelector("#inbox-summary");
  if (summary) {
    summary.innerHTML = `
      <article>
        <strong>${escapeHtml(newIncomingCount)}</strong>
        <span>новых откликов</span>
      </article>
      <article>
        <strong>${escapeHtml(conversations.length)}</strong>
        <span>личных диалогов</span>
      </article>
      <article>
        <strong>${escapeHtml(unreadCount)}</strong>
        <span>непрочитанных сообщений</span>
      </article>
      <article>
        <strong>${escapeHtml(acceptedSentCount)}</strong>
        <span>принятых моих откликов</span>
      </article>
    `;
  }

  const visibleIncomingResponses = activeInboxFilter === "new"
    ? incomingResponses.filter((response) => response.status === "NEW")
    : incomingResponses;
  const incomingRows = visibleIncomingResponses.map((response) => {
    const profile = response.sender?.profile || {};
    const author = profile.displayName || profile.username || "Автор отклика";
    const title = response.status === "NEW" ? `Новый отклик от ${author}` : `Отклик от ${author}`;
    const responseText = stripRichText(response.message || "");
    return {
      title,
      status: response.status || "UNKNOWN",
      unread: response.status === "NEW" ? 1 : 0,
      time: new Date(response.createdAt || 0).getTime(),
      text: [title, author, profile.username, responseText, response.listing?.title, response.status].filter(Boolean).join(" "),
      html: `
        <article class="inbox-item status-${escapeHtml(String(response.status || "UNKNOWN").toLowerCase())}" data-response-id="${escapeHtml(response.id)}">
          ${avatarMarkup(author, profile.avatarUrl || "")}
          <div class="inbox-content">
            <strong>${escapeHtml(title)}</strong>
            <div class="message-text">${richTextToHtml(response.message)}</div>
            <span class="muted-note">К заявке: ${escapeHtml(response.listing?.title || "без названия")} · ${escapeHtml(response.status)} · ${escapeHtml(timeAgo(response.createdAt))}</span>
          </div>
          <div class="button-row">
            <button class="secondary-button" data-open-listing-from-inbox="${escapeHtml(response.listingId)}">Заявка</button>
            ${response.status === "NEW" ? `<button class="primary-button" data-accept-response="${escapeHtml(response.id)}">Принять</button>` : ""}
            ${response.status === "NEW" ? `<button class="ghost-button" data-decline-response="${escapeHtml(response.id)}">Отклонить</button>` : ""}
          </div>
        </article>
      `
    };
  });

  const sentRows = sentResponses.map((response) => {
    const author = response.listing?.author?.profile?.displayName || response.listing?.author?.profile?.username || "CO";
    const title = `Ваш отклик: ${response.listing?.title || "заявка"}`;
    const responseText = stripRichText(response.message || "");
    return {
      title,
      status: response.status || "UNKNOWN",
      unread: 0,
      time: new Date(response.createdAt || 0).getTime(),
      text: [title, author, responseText, response.status].filter(Boolean).join(" "),
      html: `
        <article class="inbox-item status-${escapeHtml(String(response.status || "UNKNOWN").toLowerCase())}" data-sent-response-id="${escapeHtml(response.id)}">
          ${avatarMarkup(author, response.listing?.author?.profile?.avatarUrl || "")}
          <div class="inbox-content">
            <strong>${escapeHtml(title)}</strong>
            <div class="message-text">${richTextToHtml(response.message)}</div>
            <span class="muted-note">${escapeHtml(response.status)} · ${escapeHtml(timeAgo(response.createdAt))}</span>
          </div>
          <button class="secondary-button" data-open-listing-from-inbox="${escapeHtml(response.listingId)}">Открыть</button>
        </article>
      `
    };
  });

  const conversationRows = conversations.map((conversation) => {
    const other = conversation.participants?.find((participant) => participant.user?.id !== authSession.user?.id) || conversation.participants?.[0];
    const profile = other?.user?.profile;
    const message = conversation.messages?.[0];
    const unreadCount = Number(conversation.unreadCount || 0);
    const title = profile?.displayName || profile?.username || "Собеседник";
    const previewText = stripRichText(message?.text || "");
    return {
      title,
      status: unreadCount ? "UNREAD" : "READ",
      unread: unreadCount,
      time: new Date(message?.createdAt || conversation.updatedAt || conversation.createdAt || 0).getTime(),
      text: [title, profile?.username, previewText, "Личный диалог"].filter(Boolean).join(" "),
      html: `
        <article class="inbox-item inbox-conversation ${unreadCount ? "has-unread" : ""} ${String(conversation.id) === String(activePrivateConversationId) ? "is-selected" : ""}" data-conversation-id="${escapeHtml(conversation.id)}">
          ${avatarMarkup(title, profile?.avatarUrl || "")}
          <div class="inbox-content">
            <strong>${escapeHtml(title)} ${unreadCount ? `<span class="pill warm">${unreadCount}</span>` : ""}</strong>
            <p>${escapeHtml(previewText || "Диалог пока пуст")}</p>
            <span class="muted-note">Личный диалог</span>
          </div>
          <button class="secondary-button" data-open-conversation="${conversation.id}">Открыть</button>
        </article>
      `
    };
  });

  const rowsByFilter = {
    all: [...incomingRows, ...sentRows, ...conversationRows],
    new: incomingRows,
    sent: sentRows,
    dialogs: conversationRows
  };
  const emptyText = {
    all: "Когда вы отправите отклик или примете чужой, он появится здесь.",
    new: "Новых откликов сейчас нет. Можно спокойно выдохнуть и открыть диалоги.",
    sent: "Вы пока не отправляли отклики на чужие заявки.",
    dialogs: "Диалогов пока нет. Принятые отклики создадут личные переписки."
  };
  const baseRows = rowsByFilter[activeInboxFilter] || rowsByFilter.all;
  const rows = baseRows
    .filter((row) => !search || row.text.toLowerCase().includes(search))
    .sort((a, b) => {
      if (sort === "unread") return Number(b.unread || 0) - Number(a.unread || 0) || Number(b.time || 0) - Number(a.time || 0);
      if (sort === "status") return String(a.status || "").localeCompare(String(b.status || ""), "ru") || Number(b.time || 0) - Number(a.time || 0);
      if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "ru");
      return Number(b.time || 0) - Number(a.time || 0);
    });
  if (countNote) {
    countNote.textContent = search
      ? `Найдено ${rows.length} из ${baseRows.length} ${plural(baseRows.length, ["элемента", "элементов", "элементов"])} в текущей вкладке.`
      : `${baseRows.length} ${plural(baseRows.length, ["элемент", "элемента", "элементов"])} в текущей вкладке.`;
  }
  box.innerHTML = rows.length
    ? rows.map((row) => row.html).join("")
    : `<article class="inbox-item inbox-empty"><div class="avatar">CO</div><div class="inbox-content"><strong>Пока пусто</strong><p>${escapeHtml(emptyText[activeInboxFilter] || emptyText.all)}</p></div></article>`;
}

function conversationTitle(conversation) {
  const other = conversation?.participants?.find((participant) => participant.user?.id !== authSession.user?.id) || conversation?.participants?.[0];
  const profile = other?.user?.profile;
  return profile?.displayName || profile?.username || "Личный диалог";
}

function renderPrivateMessages(messages = activePrivateMessages, { updateCache = true } = {}) {
  if (updateCache) activePrivateMessages = messages;
  const box = document.querySelector("#private-messages");
  if (!box) return;
  const search = document.querySelector("#private-search")?.value.trim().toLowerCase() || "";
  const searchStatus = document.querySelector("#private-search-status");
  const visibleMessages = search
    ? activePrivateMessages.filter((message) => {
        const profile = message.sender?.profile || {};
        return [
          profile.displayName,
          profile.username,
          message.sender?.email,
          stripRichText(message.text || "")
        ].filter(Boolean).join(" ").toLowerCase().includes(search);
      })
    : activePrivateMessages;
  if (searchStatus) {
    searchStatus.textContent = activePrivateConversationId
      ? search
        ? `Найдено ${visibleMessages.length} ${plural(visibleMessages.length, ["сообщение", "сообщения", "сообщений"])}.`
        : "Показываем сообщения открытого диалога."
      : "Откройте диалог для поиска.";
  }
  box.innerHTML = visibleMessages.length
    ? visibleMessages.map((message) => {
        const profile = message.sender?.profile || {};
        const author = profile.displayName || profile.username || "Собеседник";
        const own = message.sender?.id === authSession.user?.id;
        const time = message.createdAt ? new Date(message.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
        return `
          <article class="message ${own ? "own" : ""}" data-private-message-id="${escapeHtml(message.id)}">
            <div class="message-head">
              ${avatarMarkup(own ? "Вы" : author, profile.avatarUrl || "", "small")}
              <strong>${escapeHtml(own ? "Вы" : author)}</strong>
              <span>${escapeHtml(time)}</span>
            </div>
            <div class="message-text">${richTextToHtml(message.text)}</div>
            <div class="message-actions">
              ${own ? `<button type="button" data-delete-private-message="${escapeHtml(message.id)}">Удалить</button>` : ""}
              ${own ? "" : `<button type="button" class="danger-action" data-report-private-message="${escapeHtml(message.id)}" aria-label="Пожаловаться на личное сообщение">Пожаловаться</button>`}
            </div>
          </article>
        `;
      }).join("")
    : `<article class="message"><p class="message-text">${escapeHtml(search ? "Сообщений по запросу не найдено." : "Сообщений пока нет. Напишите первым.")}</p>${search ? `<div class="message-actions"><button type="button" data-clear-private-search>Сбросить поиск</button></div>` : ""}</article>`;
  box.scrollTop = box.scrollHeight;
  updatePrivateHistoryControls();
}

function updatePrivateHistoryControls() {
  const button = document.querySelector("#load-older-private");
  const status = document.querySelector("#private-history-status");
  const search = document.querySelector("#private-search")?.value.trim() || "";
  if (button) {
    button.disabled = privateLoadingOlder || !activePrivateConversationId || !privateHasMore || !activePrivateMessages.length || Boolean(search);
    button.textContent = privateLoadingOlder ? "Загружаю историю..." : "Загрузить старые сообщения";
  }
  if (status) {
    status.textContent = !activePrivateConversationId
      ? "Выберите диалог, чтобы увидеть сообщения."
      : search
        ? "Поиск идет по уже загруженным сообщениям."
        : privateLoadingOlder
          ? "Поднимаю более ранние личные сообщения."
          : privateHasMore
            ? "Можно дозагрузить более раннюю историю диалога."
            : "Вся доступная история диалога загружена.";
  }
}

function setPrivateComposer(enabled, note = "") {
  const input = document.querySelector("#private-message-input");
  const button = document.querySelector("#private-submit");
  const refresh = document.querySelector("#private-refresh");
  const copy = document.querySelector("#copy-private-link");
  const search = document.querySelector("#private-search");
  const clearSearch = document.querySelector("#clear-private-search");
  const older = document.querySelector("#load-older-private");
  const noteBox = document.querySelector("#private-note");
  if (!input || !button) return;
  input.disabled = !enabled;
  updateRichEditorDisabled("private-message-input");
  refresh?.classList.toggle("is-hidden", !enabled);
  copy?.classList.toggle("is-hidden", !enabled);
  if (search) search.disabled = !enabled;
  if (clearSearch) clearSearch.disabled = !enabled;
  if (older) older.disabled = !enabled || !privateHasMore;
  if (noteBox) noteBox.textContent = note || (enabled ? "Диалог открыт." : "Сначала откройте диалог из списка.");
  if (!enabled) {
    activePrivateMessages = [];
    privateHasMore = false;
    privateLoadingOlder = false;
    if (search) search.value = "";
    renderPrivateMessages([], { updateCache: true });
  }
  updatePrivateComposerState();
  updatePrivateHistoryControls();
}

function updatePrivateComposerState() {
  const input = document.querySelector("#private-message-input");
  const counter = document.querySelector("#private-counter");
  const submit = document.querySelector("#private-submit");
  const value = input?.value || "";
  const textLength = richPlainLength(value);
  const storedOk = richWithinStoredLimit(value);
  const canSend = Boolean(activePrivateConversationId && !input?.disabled && stripRichText(value) && storedOk);
  if (counter) {
    counter.textContent = `${textLength} / 4000`;
    counter.classList.toggle("is-warning", textLength > 3600 || !storedOk);
  }
  if (submit) submit.disabled = !canSend;
  updateRichPreview("private-message-input");
}

async function openPrivateConversation(conversationId) {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы открыть диалог, войдите в аккаунт", "inbox");
    return;
  }
  activePrivateConversationId = conversationId;
  activeInboxFilter = "dialogs";
  if (currentViewName() === "inbox") {
    const targetUrl = inboxUrl(conversationId);
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (currentUrl !== targetUrl) history.pushState({ view: "inbox", conversationId }, "", targetUrl);
    updateSeo("inbox");
  }
  const title = conversationTitle(inboxConversations.find((conversation) => String(conversation.id) === String(conversationId)));
  document.querySelector("#private-title").textContent = title;
  privateHasMore = false;
  privateLoadingOlder = false;
  setPrivateComposer(false, "Загружаю сообщения...");
  renderInbox(inboxPayload);
  try {
    const messages = await apiFetch(`/conversations/${conversationId}/messages`);
    privateHasMore = Array.isArray(messages) && messages.length >= privatePageSize;
    renderPrivateMessages(messages);
    setPrivateComposer(true, "Можно отвечать прямо из inbox.");
    apiFetch(`/conversations/${conversationId}/read`, { method: "POST" }).catch(() => null);
  } catch {
    setPrivateComposer(false, "Не удалось загрузить диалог.");
    showToast("Не удалось открыть личный диалог");
  }
}

async function loadOlderPrivateMessages() {
  if (privateLoadingOlder || !privateHasMore || !activePrivateConversationId || !activePrivateMessages.length) return;
  const box = document.querySelector("#private-messages");
  const previousHeight = box?.scrollHeight || 0;
  const cursor = activePrivateMessages[0]?.id;
  if (!cursor) return;
  privateLoadingOlder = true;
  updatePrivateHistoryControls();
  try {
    const batch = await apiFetch(`/conversations/${activePrivateConversationId}/messages?cursor=${encodeURIComponent(cursor)}`);
    const knownIds = new Set(activePrivateMessages.map((message) => String(message.id)));
    const olderMessages = (Array.isArray(batch) ? batch : []).filter((message) => !knownIds.has(String(message.id)));
    privateHasMore = Array.isArray(batch) && batch.length >= privatePageSize;
    if (olderMessages.length) activePrivateMessages = [...olderMessages, ...activePrivateMessages];
    renderPrivateMessages(activePrivateMessages, { updateCache: true });
    if (box) box.scrollTop = Math.max(0, box.scrollHeight - previousHeight);
    if (!olderMessages.length && !privateHasMore) showToast("Более ранних личных сообщений нет");
  } catch (error) {
    showToast(apiFailure("Не удалось загрузить старые личные сообщения", error));
  } finally {
    privateLoadingOlder = false;
    updatePrivateHistoryControls();
  }
}

async function loadInbox() {
  if (!authSession.accessToken) return;
  try {
    const [conversations, sentResponses, incomingResponses] = await Promise.all([
      apiFetch("/conversations"),
      apiFetch("/listings/mine/responses"),
      apiFetch("/listings/mine/incoming-responses")
    ]);
    inboxPayload = { conversations, sentResponses, incomingResponses };
    renderInbox(inboxPayload);
    if (activePrivateConversationId) {
      const stillExists = conversations.some((conversation) => String(conversation.id) === String(activePrivateConversationId));
      if (stillExists) await openPrivateConversation(activePrivateConversationId);
    }
  } catch {
    showToast("Не удалось обновить inbox");
  }
}

function isAuthenticated() {
  return Boolean(authSession.accessToken && authSession.user?.email);
}

function isOwner(role = authSession.user?.role) {
  return role === "OWNER";
}

function isAdmin(role = authSession.user?.role) {
  return role === "ADMIN";
}

function isModerator(role = authSession.user?.role) {
  return role === "MODERATOR";
}

function isStaff(role = authSession.user?.role) {
  return isOwner(role) || isAdmin(role) || isModerator(role);
}

function isOwnerAdmin(role = authSession.user?.role) {
  return isOwner(role) || isAdmin(role);
}

function roleNavLink({ href, viewLink, label }) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  link.dataset.dynamicRoleNav = "true";
  if (viewLink) link.dataset.viewLink = viewLink;
  return link;
}

function renderRoleNavigation() {
  if (!mainNav) return;
  mainNav.querySelectorAll("[data-dynamic-role-nav]").forEach((link) => link.remove());
  if (!isAuthenticated() || !isStaff()) return;
  mainNav.append(roleNavLink({ href: "/admin", viewLink: "admin", label: isModerator() && !isAdmin() && !isOwner() ? "Модерация" : "Админка" }));
  if (isOwner()) {
    mainNav.append(roleNavLink({ href: "/admin?tab=launch", label: "Owner tools" }));
  }
}

function accountRoleLabel(role = "USER") {
  return {
    OWNER: "Владелец",
    ADMIN: "Администратор",
    MODERATOR: "Модератор",
    PREMIUM_USER: "Premium пользователь",
    USER: "Пользователь"
  }[role] || role;
}

function renderAccountRolePanel(me = authSession.user || {}) {
  const role = me.role || "USER";
  const note = document.querySelector("#account-role-note");
  const box = document.querySelector("#account-role-cards");
  if (!box) return;
  const staffRole = ["OWNER", "ADMIN", "MODERATOR"].includes(role);
  const launchRole = isOwnerAdmin(role);
  if (note) {
    note.textContent = staffRole
      ? `${accountRoleLabel(role)}: личные инструменты дополнены служебными разделами.`
      : `${accountRoleLabel(role)}: доступны профиль, заявки, отклики, диалоги и безопасность аккаунта.`;
  }
  const cards = [
    {
      badge: accountRoleLabel(role),
      title: "Личный контур",
      text: "Редактируйте профиль, аватар, обложку, творческие предпочтения и приватность.",
      action: "profile",
      label: "К профилю"
    },
    {
      badge: "Заявки",
      title: "Поиск и отклики",
      text: "Создавайте заявки, отслеживайте ответы и возвращайтесь к понравившимся карточкам.",
      action: "new-listing",
      label: "Создать заявку"
    },
    {
      badge: "Inbox",
      title: "Диалоги",
      text: "Продолжайте личные переписки, принимайте отклики и проверяйте уведомления.",
      action: "inbox",
      label: "Открыть inbox"
    }
  ];
  if (staffRole) {
    cards.push({
      badge: "Staff",
      title: "Модерация",
      text: "Проверяйте жалобы, предложения и заявки, не смешивая служебные действия с пользовательскими.",
      action: "admin",
      label: "Открыть админку"
    });
  }
  if (launchRole) {
    cards.push({
      badge: "Launch",
      title: "Запуск и управление",
      text: "Платные функции, SEO, реклама, финансы и аудит доступны только OWNER/ADMIN.",
      action: "admin",
      label: "Настройки запуска"
    });
  }
  box.innerHTML = cards.map((card) => `
    <article class="role-card">
      <span class="pill ${card.badge === "Staff" || card.badge === "Launch" ? "" : "soft"}">${escapeHtml(card.badge)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <p>${escapeHtml(card.text)}</p>
      <button class="ghost-button" type="button" data-role-action="${escapeHtml(card.action)}">${escapeHtml(card.label)}</button>
    </article>
  `).join("");
}

function adminRoleRank(role) {
  return { USER: 0, PREMIUM_USER: 0, MODERATOR: 1, ADMIN: 2, OWNER: 3 }[role] ?? -1;
}

function canManageAdminUser(user) {
  if (!authSession.user || user.id === authSession.user.id) return false;
  if (authSession.user.role === "OWNER") return true;
  return adminRoleRank(authSession.user.role) > adminRoleRank(user.role);
}

function canAssignAdminRole(role) {
  if (!authSession.user) return false;
  if (authSession.user.role === "OWNER") return true;
  return adminRoleRank(role) < adminRoleRank(authSession.user.role);
}

function renderAdminMetrics(dashboard) {
  const box = document.querySelector("#admin-metrics");
  if (!box || !dashboard) return;
  box.innerHTML = `
    <article><strong>${dashboard.users}</strong><span>пользователя</span></article>
    <article><strong>${dashboard.listings}</strong><span>заявок</span></article>
    <article><strong>${dashboard.reports}</strong><span>жалоб</span></article>
    <article><strong>${dashboard.suggestions}</strong><span>предложений</span></article>
    <article><strong>${dashboard.settings?.monetizationEnabled ? "вкл" : "выкл"}</strong><span>платные функции</span></article>
  `;
}

function renderAdminSettings(settings = featureFlags) {
  const checkbox = document.querySelector("#admin-monetization-enabled");
  const aiCheckbox = document.querySelector("#admin-ai-enabled");
  const note = document.querySelector("#admin-settings-note");
  if (checkbox) checkbox.checked = Boolean(settings.monetizationEnabled);
  if (aiCheckbox) aiCheckbox.checked = Boolean(settings.aiEnabled);
  if (note) {
    note.textContent = settings.monetizationEnabled
      ? "Premium и оформление подписки видны пользователям. Перед публичным трафиком проверьте платежного провайдера."
      : "Платные функции скрыты для пользователей до ручного включения OWNER/ADMIN.";
  }
}

function renderAdminQueue({ reports = [], suggestions = [], listings: adminListings = [] } = {}) {
  adminQueueCache = { reports, suggestions, listings: adminListings };
  const tbody = document.querySelector("#admin-queue");
  const countNote = document.querySelector("#admin-queue-count");
  if (!tbody) return;
  const search = document.querySelector("#admin-queue-search")?.value.trim().toLowerCase() || "";
  const kindFilter = document.querySelector("#admin-queue-kind")?.value || "all";
  const statusFilter = document.querySelector("#admin-queue-status")?.value || "all";
  const rows = [
    ...reports.slice(0, 5).map((report) => ({
      id: report.id,
      kind: "report",
      object: `${report.entityType} ${report.entityId.slice(0, 8)}`,
      status: report.status,
      reason: report.reason,
      actions: [
        { action: "resolve-report", label: "Закрыть" },
        { action: "reject-report", label: "Отклонить" }
      ]
    })),
    ...suggestions.slice(0, 5).map((suggestion) => ({
      id: suggestion.id,
      kind: "suggestion",
      object: `${suggestion.type}: ${suggestion.title}`,
      status: suggestion.status,
      reason: "Предложение",
      actions: [
        { action: "approve-suggestion", label: "Одобрить" },
        { action: "reject-suggestion", label: "Отклонить" }
      ]
    })),
    ...adminListings.filter((listing) => listing.moderationStatus !== "APPROVED").slice(0, 5).map((listing) => {
      const hidden = listing.status === "DELETED" || listing.status === "HIDDEN" || listing.moderationStatus === "HIDDEN";
      return {
        id: listing.id,
        kind: "listing",
        object: `Заявка: ${listing.title}`,
        status: `${listing.status} / ${listing.moderationStatus}`,
        reason: listing.ageRating,
        actions: hidden
          ? [
              { action: "restore-listing", label: "Восстановить" },
              { action: "approve-listing", label: "Одобрить" }
            ]
          : [
              { action: "approve-listing", label: "Одобрить" },
              { action: "hide-listing", label: "Скрыть" }
            ]
      };
    })
  ];
  const visibleRows = rows.filter((row) => {
    const haystack = [row.kind, row.object, row.status, row.reason].filter(Boolean).join(" ").toLowerCase();
    return (!search || haystack.includes(search)) &&
      (kindFilter === "all" || row.kind === kindFilter) &&
      (statusFilter === "all" || String(row.status || "").includes(statusFilter));
  });
  if (countNote) {
    countNote.textContent = search || kindFilter !== "all" || statusFilter !== "all"
      ? `Показано ${visibleRows.length} из ${rows.length} ${plural(rows.length, ["элемента", "элементов", "элементов"])} очереди.`
      : `${rows.length} ${plural(rows.length, ["элемент", "элемента", "элементов"])} в очереди модерации.`;
  }
  if (!visibleRows.length) {
    tbody.innerHTML = `<tr><td colspan="4">Очередь модерации пуста</td></tr>`;
    return;
  }
  tbody.innerHTML = visibleRows.map((row) => `
    <tr data-admin-row="${escapeHtml(row.id)}" data-admin-kind="${escapeHtml(row.kind)}">
      <td>${escapeHtml(row.object)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.reason)}</td>
      <td>
        <div class="button-row">
          ${row.actions.map((item) => `<button type="button" data-admin-action="${escapeHtml(item.action)}" data-admin-id="${escapeHtml(row.id)}">${escapeHtml(item.label)}</button>`).join("")}
        </div>
      </td>
    </tr>
  `).join("");
}

function renderAuditLog(items = []) {
  adminAuditCache = items;
  const box = document.querySelector("#admin-audit-log");
  const countNote = document.querySelector("#admin-audit-count");
  if (!box) return;
  const search = document.querySelector("#admin-audit-search")?.value.trim().toLowerCase() || "";
  const entity = document.querySelector("#admin-audit-entity")?.value || "all";
  const visibleItems = items.filter((item) => {
    const actor = item.actor?.profile?.displayName || item.actor?.profile?.username || item.actor?.email || "system";
    const metadata = item.metadata && typeof item.metadata === "object" ? JSON.stringify(item.metadata) : "";
    const haystack = [
      item.action,
      item.entityType,
      item.entityId,
      actor,
      item.actor?.role,
      metadata
    ].filter(Boolean).join(" ").toLowerCase();
    return (!search || haystack.includes(search)) &&
      (entity === "all" || item.entityType === entity);
  });
  if (countNote) {
    countNote.textContent = search || entity !== "all"
      ? `Показано ${visibleItems.length} из ${items.length} ${plural(items.length, ["записи", "записей", "записей"])} audit.`
      : `${items.length} ${plural(items.length, ["запись", "записи", "записей"])} audit log.`;
  }
  box.innerHTML = visibleItems.length
    ? visibleItems.slice(0, 20).map((item) => {
        const actor = item.actor?.profile?.displayName || item.actor?.profile?.username || "system";
        const time = item.createdAt ? new Date(item.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
        const metadata = item.metadata && typeof item.metadata === "object"
          ? Object.entries(item.metadata)
              .filter(([, value]) => value !== null && value !== undefined && value !== "")
              .slice(0, 3)
              .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
              .join(" · ")
          : "";
        return `
          <article>
            <strong>${escapeHtml(item.action)} · ${escapeHtml(item.entityType)} ${escapeHtml(String(item.entityId || "").slice(0, 8))}</strong>
            <p>${escapeHtml(actor)} · ${escapeHtml(item.actor?.role || "")} · ${escapeHtml(time)}${metadata ? ` · ${escapeHtml(metadata)}` : ""}</p>
          </article>
        `;
      }).join("")
    : `<article><strong>Audit log пуст</strong><p>${search || entity !== "all" ? "По текущим фильтрам записей нет." : "Действия модерации и администрирования появятся здесь."}</p></article>`;
}

function renderAdminUsers(users = []) {
  adminUsersCache = users;
  const tbody = document.querySelector("#admin-users");
  const countNote = document.querySelector("#admin-users-count");
  if (!tbody) return;
  const search = document.querySelector("#admin-users-search")?.value.trim().toLowerCase() || "";
  const role = document.querySelector("#admin-users-role")?.value || "all";
  const status = document.querySelector("#admin-users-status")?.value || "all";
  const visibleUsers = users.filter((user) => {
    const haystack = [
      user.email,
      user.role,
      user.status,
      user.profile?.displayName,
      user.profile?.username
    ].filter(Boolean).join(" ").toLowerCase();
    return (!search || haystack.includes(search)) &&
      (role === "all" || user.role === role) &&
      (status === "all" || user.status === status);
  });
  if (countNote) {
    countNote.textContent = search || role !== "all" || status !== "all"
      ? `Показано ${visibleUsers.length} из ${users.length} ${plural(users.length, ["пользователя", "пользователей", "пользователей"])}.`
      : `${users.length} ${plural(users.length, ["пользователь", "пользователя", "пользователей"])} в таблице.`;
  }
  if (!visibleUsers.length) {
    tbody.innerHTML = `<tr><td colspan="4">Пользователи не найдены</td></tr>`;
    return;
  }
  tbody.innerHTML = visibleUsers.slice(0, 20).map((user) => {
    const name = user.profile?.displayName || user.profile?.username || user.email;
    const canManage = canManageAdminUser(user);
    const canMakeMod = canManage && canAssignAdminRole("MODERATOR") && user.role !== "MODERATOR";
    const canMakeUser = canManage && canAssignAdminRole("USER") && user.role !== "USER";
    return `
      <tr data-admin-user="${escapeHtml(user.id)}">
        <td>${escapeHtml(name)}<br><span class="muted-note">${escapeHtml(user.email)}</span></td>
        <td>${escapeHtml(user.role)}</td>
        <td>${escapeHtml(user.status)}${user.isPremium ? " · Premium" : ""}<br><span class="muted-note">${escapeHtml(activityLabel(user.lastSeenAt))}</span></td>
        <td>
          <div class="button-row">
            ${user.status === "ACTIVE" && canManage ? `<button type="button" data-admin-user-action="temp-ban" data-user-id="${escapeHtml(user.id)}">Temp ban</button>` : ""}
            ${user.status === "DELETED" && canManage ? `<button type="button" data-admin-user-action="restore" data-user-id="${escapeHtml(user.id)}">Restore</button>` : ""}
            ${user.status !== "ACTIVE" && user.status !== "DELETED" && canManage ? `<button type="button" data-admin-user-action="unban" data-user-id="${escapeHtml(user.id)}">Unban</button>` : ""}
            ${canMakeMod ? `<button type="button" data-admin-user-action="make-mod" data-user-id="${escapeHtml(user.id)}">Mod</button>` : ""}
            ${canMakeUser ? `<button type="button" data-admin-user-action="make-user" data-user-id="${escapeHtml(user.id)}">User</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadAdminUsers() {
  if (!authSession.accessToken || !isStaff()) return;
  try {
    renderAdminUsers(await apiFetch("/admin/users"));
  } catch {
    const tbody = document.querySelector("#admin-users");
    if (tbody) tbody.innerHTML = `<tr><td colspan="4">Не удалось загрузить пользователей.</td></tr>`;
  }
}

function renderAdminCatalogList(kind, items = []) {
  adminCatalogCache[kind] = items;
  const settings = {
    tags: {
      list: "#admin-tags-list",
      search: "#admin-tags-search",
      status: "#admin-tags-status-filter",
      count: "#admin-tags-count",
      emptyTitle: "Тегов пока нет",
      emptyText: "Создайте первый тег через форму выше.",
      notFound: "Теги не найдены по фильтрам",
      singular: "тег",
      few: "тега",
      many: "тегов",
      data: "data-admin-tag",
      edit: "data-edit-admin-tag",
      meta: (tag) => tag.slug
    },
    genres: {
      list: "#admin-genres-list",
      search: "#admin-genres-search",
      status: "#admin-genres-status-filter",
      count: "#admin-genres-count",
      emptyTitle: "Жанров пока нет",
      emptyText: "Создайте первый жанр через форму выше.",
      notFound: "Жанры не найдены по фильтрам",
      singular: "жанр",
      few: "жанра",
      many: "жанров",
      data: "data-admin-genre",
      edit: "data-edit-admin-genre",
      meta: (genre) => genre.slug
    },
    fandoms: {
      list: "#admin-fandoms-list",
      search: "#admin-fandoms-search",
      status: "#admin-fandoms-status-filter",
      count: "#admin-fandoms-count",
      emptyTitle: "Фандомов пока нет",
      emptyText: "Создайте первый фандом через форму выше.",
      notFound: "Фандомы не найдены по фильтрам",
      singular: "фандом",
      few: "фандома",
      many: "фандомов",
      data: "data-admin-fandom",
      edit: "data-edit-admin-fandom",
      meta: (fandom) => `${fandom.slug} · id: ${fandom.id}`
    },
    characters: {
      list: "#admin-characters-list",
      search: "#admin-characters-search",
      status: "#admin-characters-status-filter",
      count: "#admin-characters-count",
      emptyTitle: "Персонажей пока нет",
      emptyText: "Создайте первого персонажа через форму выше.",
      notFound: "Персонажи не найдены по фильтрам",
      singular: "персонаж",
      few: "персонажа",
      many: "персонажей",
      data: "data-admin-character",
      edit: "data-edit-admin-character",
      meta: (character) => `${character.slug}${character.fandom?.name ? ` · ${character.fandom.name}` : ""}`
    }
  };
  const config = settings[kind];
  const box = document.querySelector(config.list);
  const countNote = document.querySelector(config.count);
  if (!box) return;
  const search = document.querySelector(config.search)?.value.trim().toLowerCase() || "";
  const status = document.querySelector(config.status)?.value || "all";
  const visibleItems = items.filter((item) => {
    const meta = config.meta(item);
    const haystack = [item.name, item.slug, item.status, item.description, item.id, item.fandom?.name, meta]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return (!search || haystack.includes(search)) &&
      (status === "all" || (item.status || "APPROVED") === status);
  }).sort((a, b) => String(a.name || a.slug || "").localeCompare(String(b.name || b.slug || ""), "ru"));
  if (countNote) {
    countNote.textContent = search || status !== "all"
      ? `Показано ${visibleItems.length} из ${items.length} ${plural(items.length, [config.singular, config.few, config.many])}.`
      : `${items.length} ${plural(items.length, [config.singular, config.few, config.many])} в справочнике.`;
  }
  box.innerHTML = visibleItems.length
    ? visibleItems.slice(0, 30).map((item) => {
        const meta = config.meta(item);
        return `
        <article ${config.data}="${escapeHtml(item.slug)}">
          <strong>${escapeHtml(item.name)} <span class="pill soft">${escapeHtml(item.status || "APPROVED")}</span></strong>
          <p>${escapeHtml(meta)}${item.description ? ` · ${escapeHtml(item.description)}` : ""}</p>
          <button type="button" ${config.edit}="${escapeHtml(item.slug)}">Редактировать</button>
        </article>
      `;
      }).join("")
    : `<article><strong>${escapeHtml(search || status !== "all" ? config.notFound : config.emptyTitle)}</strong><p>${escapeHtml(search || status !== "all" ? "Измените поиск или статус." : config.emptyText)}</p></article>`;
}

function renderAdminTags(tags = []) {
  renderAdminCatalogList("tags", tags);
}

function renderAdminGenres(genres = []) {
  renderAdminCatalogList("genres", genres);
}

async function loadAdminGenres() {
  if (!authSession.accessToken || !isStaff()) return;
  try {
    renderAdminGenres(await apiFetch("/admin/genres"));
  } catch {
    renderAdminGenres([]);
  }
}

function renderAdminFandoms(fandoms = []) {
  renderAdminCatalogList("fandoms", fandoms);
}

async function loadAdminFandoms() {
  if (!authSession.accessToken || !isStaff()) return;
  try {
    renderAdminFandoms(await apiFetch("/admin/fandoms"));
  } catch {
    renderAdminFandoms([]);
  }
}

function renderAdminCharacters(characters = []) {
  renderAdminCatalogList("characters", characters);
}

async function loadAdminCharacters() {
  if (!authSession.accessToken || !isStaff()) return;
  try {
    renderAdminCharacters(await apiFetch("/admin/characters"));
  } catch {
    renderAdminCharacters([]);
  }
}

function renderAdminPlans(plans = []) {
  adminPlansCache = plans;
  const box = document.querySelector("#admin-plans-list");
  const countNote = document.querySelector("#admin-plans-count");
  if (!box) return;
  const search = document.querySelector("#admin-plans-search")?.value.trim().toLowerCase() || "";
  const status = document.querySelector("#admin-plans-status-filter")?.value || "all";
  const visiblePlans = plans.filter((plan) => {
    const haystack = [plan.code, plan.name, plan.description, plan.currency, plan.durationDays, plan.priceCents]
      .filter((value) => value !== null && value !== undefined)
      .join(" ")
      .toLowerCase();
    return (!search || haystack.includes(search)) &&
      (status === "all" || (status === "active" ? plan.isActive : !plan.isActive));
  }).sort((a, b) => (a.priceCents || 0) - (b.priceCents || 0));
  if (countNote) {
    countNote.textContent = search || status !== "all"
      ? `Показано ${visiblePlans.length} из ${plans.length} ${plural(plans.length, ["тарифа", "тарифов", "тарифов"])}.`
      : `${plans.length} ${plural(plans.length, ["тариф", "тарифа", "тарифов"])} Premium.`;
  }
  box.innerHTML = visiblePlans.length
    ? visiblePlans.map((plan) => `
        <article>
          <strong>${escapeHtml(plan.name)} <span class="pill ${plan.isActive ? "soft" : "warm"}">${plan.isActive ? "ACTIVE" : "OFF"}</span></strong>
          <p>${escapeHtml(plan.code)} · ${Math.round(plan.priceCents / 100)} ${escapeHtml(plan.currency)} · ${plan.durationDays} дн.</p>
          <button type="button" data-edit-admin-plan="${escapeHtml(plan.code)}">Редактировать</button>
        </article>
      `).join("")
    : `<article><strong>${search || status !== "all" ? "Тарифы не найдены по фильтрам" : "Тарифов пока нет"}</strong><p>${search || status !== "all" ? "Измените поиск или статус." : "Создайте тариф через форму выше."}</p></article>`;
}

function renderAdminAds(ads = []) {
  adminAdsCache = ads;
  const box = document.querySelector("#admin-ads-list");
  const countNote = document.querySelector("#admin-ads-count");
  if (!box) return;
  const search = document.querySelector("#admin-ads-search")?.value.trim().toLowerCase() || "";
  const position = document.querySelector("#admin-ads-position-filter")?.value || "all";
  const status = document.querySelector("#admin-ads-status-filter")?.value || "all";
  const visibleAds = ads.filter((ad) => {
    const haystack = [ad.name, ad.status, ad.position, ad.clickUrl, ad.imageUrl, ad.impressionLimit, ad.impressions]
      .filter((value) => value !== null && value !== undefined)
      .join(" ")
      .toLowerCase();
    return (!search || haystack.includes(search)) &&
      (position === "all" || ad.position === position) &&
      (status === "all" || ad.status === status);
  }).sort((a, b) => String(a.position || "").localeCompare(String(b.position || ""), "ru") || String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  if (countNote) {
    countNote.textContent = search || position !== "all" || status !== "all"
      ? `Показано ${visibleAds.length} из ${ads.length} ${plural(ads.length, ["placement", "placement'а", "placement'ов"])}.`
      : `${ads.length} ${plural(ads.length, ["placement", "placement'а", "placement'ов"])} рекламы.`;
  }
  box.innerHTML = visibleAds.length
    ? visibleAds.slice(0, 30).map((ad) => `
        <article>
          <strong>${escapeHtml(ad.name)} <span class="pill ${ad.status === "ACTIVE" ? "soft" : "warm"}">${escapeHtml(ad.status)}</span></strong>
          <p>${escapeHtml(ad.position)}${ad.clickUrl ? ` · ${escapeHtml(ad.clickUrl)}` : ""}</p>
          <p>${ad.impressionLimit == null ? "без лимита" : `${escapeHtml(ad.impressions || 0)}/${escapeHtml(ad.impressionLimit)} показов`}${ad.startsAt ? ` · старт ${escapeHtml(new Date(ad.startsAt).toLocaleDateString("ru-RU"))}` : ""}${ad.endsAt ? ` · до ${escapeHtml(new Date(ad.endsAt).toLocaleDateString("ru-RU"))}` : ""}${ad.target?.hideForPremium ? " · скрыто для Premium" : ""}</p>
          <button type="button" data-edit-admin-ad="${escapeHtml(ad.id)}">Редактировать</button>
        </article>
      `).join("")
    : `<article><strong>${search || position !== "all" || status !== "all" ? "Реклама не найдена по фильтрам" : "Placement'ов пока нет"}</strong><p>${search || position !== "all" || status !== "all" ? "Измените поиск, позицию или статус." : "Создайте рекламное место через форму выше."}</p></article>`;
}

function renderAdminFinance({ payments = [], subscriptions = [] } = {}) {
  adminFinanceCache = { payments, subscriptions };
  const box = document.querySelector("#admin-finance-list");
  const countNote = document.querySelector("#admin-finance-count");
  if (!box) return;
  const search = document.querySelector("#admin-finance-search")?.value.trim().toLowerCase() || "";
  const kind = document.querySelector("#admin-finance-kind")?.value || "all";
  const status = document.querySelector("#admin-finance-status")?.value || "all";
  const rows = [
    ...payments.map((payment) => ({
      kind: "payment",
      status: payment.status,
      title: `${payment.user?.profile?.displayName || payment.user?.email || "Пользователь"} · ${payment.status}`,
      meta: `${payment.plan?.name || "План"} · ${payment.provider}`,
      amount: `${Math.round(payment.amountCents / 100)} ${payment.currency}`,
      time: payment.createdAt || payment.updatedAt
    })),
    ...subscriptions.map((subscription) => ({
      kind: "subscription",
      status: subscription.status,
      title: `${subscription.user?.profile?.displayName || subscription.user?.email || "Пользователь"} · ${subscription.status}`,
      meta: `${subscription.plan?.name || "План"} · до ${subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString("ru-RU") : "без даты"}`,
      amount: "SUB",
      time: subscription.expiresAt || subscription.updatedAt || subscription.createdAt
    }))
  ];
  const visibleRows = rows.filter((row) => {
    const haystack = [row.kind, row.status, row.title, row.meta, row.amount].filter(Boolean).join(" ").toLowerCase();
    return (!search || haystack.includes(search)) &&
      (kind === "all" || row.kind === kind) &&
      (status === "all" || row.status === status);
  }).sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
  if (countNote) {
    countNote.textContent = search || kind !== "all" || status !== "all"
      ? `Показано ${visibleRows.length} из ${rows.length} ${plural(rows.length, ["финансовой записи", "финансовых записей", "финансовых записей"])}.`
      : `${rows.length} ${plural(rows.length, ["финансовая запись", "финансовые записи", "финансовых записей"])}: ${payments.length} платежей, ${subscriptions.length} подписок.`;
  }
  box.innerHTML = visibleRows.length
    ? visibleRows.slice(0, 30).map((row) => `
        <article>
          <div>
            <strong>${escapeHtml(row.title)} <span class="pill soft">${escapeHtml(row.kind)}</span></strong>
            <p>${escapeHtml(row.meta)}</p>
          </div>
          <strong>${escapeHtml(row.amount)}</strong>
        </article>
      `).join("")
    : `<article><div><strong>Финансовых событий пока нет</strong><p>${search || kind !== "all" || status !== "all" ? "По текущим фильтрам записей нет." : "Checkout и активные подписки появятся здесь."}</p></div></article>`;
}

function renderAdminSeoPages(pages = []) {
  adminSeoCache = pages;
  const box = document.querySelector("#admin-seo-list");
  const countNote = document.querySelector("#admin-seo-count");
  if (!box) return;
  const search = document.querySelector("#admin-seo-search")?.value.trim().toLowerCase() || "";
  const indexFilter = document.querySelector("#admin-seo-index-filter")?.value || "all";
  const visiblePages = pages.filter((page) => {
    const haystack = [page.path, page.title, page.h1, page.description, page.canonical, page.ogTitle, page.ogDescription, page.ogImage, page.seoText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return (!search || haystack.includes(search)) &&
      (indexFilter === "all" || (indexFilter === "index" ? page.indexable !== false : page.indexable === false));
  }).sort((a, b) => String(a.path || "").localeCompare(String(b.path || ""), "ru"));
  if (countNote) {
    countNote.textContent = search || indexFilter !== "all"
      ? `Показано ${visiblePages.length} из ${pages.length} ${plural(pages.length, ["SEO-страницы", "SEO-страниц", "SEO-страниц"])}.`
      : `${pages.length} ${plural(pages.length, ["SEO-страница", "SEO-страницы", "SEO-страниц"])}.`;
  }
  box.innerHTML = visiblePages.length
    ? visiblePages.map((page) => `
        <article>
          <strong>${escapeHtml(page.path)} <span class="pill ${page.indexable ? "soft" : "warm"}">${page.indexable ? "INDEX" : "NOINDEX"}</span></strong>
          <p>${escapeHtml(page.title)} · ${escapeHtml(page.description)}</p>
          <button type="button" data-edit-admin-seo="${escapeHtml(page.path)}">Редактировать</button>
        </article>
      `).join("")
    : `<article><strong>${search || indexFilter !== "all" ? "SEO-страницы не найдены по фильтрам" : "SEO-страниц пока нет"}</strong><p>${search || indexFilter !== "all" ? "Измените поиск или фильтр индексации." : "Создайте первую страницу через форму выше."}</p></article>`;
}

async function loadAdminFinance() {
  if (!authSession.accessToken || !["OWNER", "ADMIN"].includes(authSession.user?.role)) return;
  try {
    const [payments, subscriptions] = await Promise.all([
      apiFetch("/admin/payments"),
      apiFetch("/admin/subscriptions")
    ]);
    renderAdminFinance({ payments, subscriptions });
  } catch {
    renderAdminFinance();
  }
}

async function loadAdminSettings() {
  if (!authSession.accessToken || !["OWNER", "ADMIN"].includes(authSession.user?.role)) return;
  try {
    renderAdminSettings(await apiFetch("/admin/settings"));
  } catch {
    renderAdminSettings(featureFlags);
  }
  loadAdminAiConfig();
}

function renderAdminAiConfig(view) {
  const providers = view?.providers || {};
  const select = document.querySelector("#admin-ai-provider");
  if (select) select.value = view?.defaultProvider || "anthropic";
  const setStatus = (id, has) => {
    const el = document.querySelector(id);
    if (!el) return;
    el.textContent = has ? "ключ задан" : "ключ не задан";
    el.classList.toggle("is-set", Boolean(has));
  };
  const setVal = (id, value) => {
    const el = document.querySelector(id);
    if (el) el.value = value || "";
  };
  setStatus("#admin-ai-anthropic-status", providers.anthropic?.hasKey);
  setStatus("#admin-ai-openai-status", providers.openai?.hasKey);
  setStatus("#admin-ai-deepseek-status", providers.deepseek?.hasKey);
  setStatus("#admin-ai-yandex-status", providers.yandex?.hasKey);
  setVal("#admin-ai-anthropic-model", providers.anthropic?.model);
  setVal("#admin-ai-openai-model", providers.openai?.model);
  setVal("#admin-ai-openai-baseurl", providers.openai?.baseUrl);
  setVal("#admin-ai-deepseek-model", providers.deepseek?.model);
  setVal("#admin-ai-deepseek-baseurl", providers.deepseek?.baseUrl);
  setVal("#admin-ai-yandex-folder", providers.yandex?.folderId);
  setVal("#admin-ai-yandex-model", providers.yandex?.model);
}

async function loadAdminAiConfig() {
  const section = document.querySelector("#admin-ai-config-section");
  if (!section) return;
  const status = document.querySelector("#admin-ai-config-status");
  const saveButton = document.querySelector("#admin-ai-config-save");
  const isOwner = authSession.user?.role === "OWNER";
  if (!isOwner) {
    if (status) status.textContent = "Управление ключами доступно только OWNER.";
    if (saveButton) saveButton.disabled = true;
    return;
  }
  if (saveButton) saveButton.disabled = false;
  try {
    renderAdminAiConfig(await apiFetch("/admin/ai-config"));
    if (status) status.textContent = "";
  } catch {
    if (status) status.textContent = "";
  }
}

document.querySelector("#admin-ai-config-save")?.addEventListener("click", async () => {
  if (authSession.user?.role !== "OWNER") return;
  const status = document.querySelector("#admin-ai-config-status");
  const saveButton = document.querySelector("#admin-ai-config-save");
  const val = (id) => (document.querySelector(id)?.value || "").trim();
  const providerObject = (keyId, fields) => {
    const obj = {};
    const key = val(keyId);
    if (key) obj.apiKey = key; // only send when typed — blank keeps the stored key
    Object.entries(fields).forEach(([prop, id]) => { obj[prop] = val(id); });
    return obj;
  };
  const payload = {
    defaultProvider: document.querySelector("#admin-ai-provider")?.value || "anthropic",
    anthropic: providerObject("#admin-ai-anthropic-key", { model: "#admin-ai-anthropic-model" }),
    openai: providerObject("#admin-ai-openai-key", { model: "#admin-ai-openai-model", baseUrl: "#admin-ai-openai-baseurl" }),
    deepseek: providerObject("#admin-ai-deepseek-key", { model: "#admin-ai-deepseek-model", baseUrl: "#admin-ai-deepseek-baseurl" }),
    yandex: providerObject("#admin-ai-yandex-key", { folderId: "#admin-ai-yandex-folder", model: "#admin-ai-yandex-model" })
  };
  if (saveButton) saveButton.disabled = true;
  if (status) status.textContent = "Сохранение…";
  try {
    renderAdminAiConfig(await apiFetch("/admin/ai-config", { method: "PATCH", body: JSON.stringify(payload) }));
    ["#admin-ai-anthropic-key", "#admin-ai-openai-key", "#admin-ai-deepseek-key", "#admin-ai-yandex-key"].forEach((id) => {
      const el = document.querySelector(id);
      if (el) el.value = "";
    });
    if (status) status.textContent = "Сохранено.";
    showToast("Настройки ИИ-провайдеров сохранены");
  } catch (error) {
    if (status) status.textContent = "";
    showToast(apiFailure("Не удалось сохранить провайдеров", error));
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
});

async function loadAdminSeoPages() {
  if (!authSession.accessToken || !["OWNER", "ADMIN"].includes(authSession.user?.role)) return;
  try {
    renderAdminSeoPages(await apiFetch("/admin/seo-pages"));
  } catch {
    renderAdminSeoPages([]);
  }
}

async function loadAdminAds() {
  if (!authSession.accessToken || !isStaff()) return;
  try {
    renderAdminAds(await apiFetch("/admin/ads"));
  } catch {
    renderAdminAds([]);
  }
}

async function loadAdminPlans() {
  if (!authSession.accessToken || !["OWNER", "ADMIN"].includes(authSession.user?.role)) return;
  try {
    renderAdminPlans(await apiFetch("/admin/subscription-plans"));
  } catch {
    renderAdminPlans([]);
  }
}

async function loadAdminTags() {
  if (!authSession.accessToken || !isStaff()) return;
  try {
    renderAdminTags(await apiFetch("/admin/tags"));
  } catch {
    renderAdminTags([]);
  }
}

function analyticsEventLabel(type) {
  const labels = {
    register: "Регистрации",
    listing_created: "Создано заявок",
    response_sent: "Отклики",
    subscription_started: "Оформлено подписок"
  };
  return labels[type] || type;
}

function renderAnalyticsList(selector, title, rows, emptyText = "Пока нет данных.") {
  const box = document.querySelector(selector);
  if (!box) return;
  const max = rows.reduce((acc, row) => Math.max(acc, row.count), 0) || 1;
  box.innerHTML = `<h3>${escapeHtml(title)}</h3>` + (rows.length
    ? rows.map((row) => {
        const pct = Math.max(3, Math.round((row.count / max) * 100));
        const label = escapeHtml(String(row.label ?? "—"));
        return `<div class="analytics-row"><span class="analytics-row-label" title="${label}">${label}</span><span class="analytics-row-bar"><span style="width:${pct}%"></span></span><span class="analytics-row-count">${compactNumber(row.count)}</span></div>`;
      }).join("")
    : `<p class="muted-note">${escapeHtml(emptyText)}</p>`);
}

function renderAdminAnalytics(data) {
  const { totals = {}, daily = [], topPages = [], topReferrers = [], topEvents = [], mobile = {} } = data || {};
  const metrics = document.querySelector("#admin-analytics-metrics");
  if (metrics) {
    const mobilePct = mobile.total ? Math.round((mobile.mobile / mobile.total) * 100) : 0;
    const avg = daily.length ? Math.round((totals.views || 0) / daily.length) : 0;
    metrics.innerHTML = `
      <article><strong>${compactNumber(totals.views || 0)}</strong><span>просмотров</span></article>
      <article><strong>${compactNumber(totals.visitors || 0)}</strong><span>визитов (уник./день)</span></article>
      <article><strong>${compactNumber(avg)}</strong><span>просмотров/день</span></article>
      <article><strong>${mobilePct}%</strong><span>с мобильных</span></article>`;
  }
  const chart = document.querySelector("#admin-analytics-chart");
  if (chart) {
    const maxViews = daily.reduce((acc, day) => Math.max(acc, day.views), 0) || 1;
    chart.innerHTML = daily.length
      ? daily.map((day) => {
          const pct = Math.max(2, Math.round((day.views / maxViews) * 100));
          return `<div class="analytics-bar" style="height:${pct}%" title="${escapeHtml(day.day)}: ${day.views} просмотров, ${day.visitors} визитов"></div>`;
        }).join("")
      : `<p class="muted-note">Пока нет данных за выбранный период.</p>`;
  }
  renderAnalyticsList("#admin-analytics-pages", "Топ страниц", topPages.map((page) => ({ label: page.path, count: page.count })));
  renderAnalyticsList("#admin-analytics-referrers", "Источники переходов", topReferrers.map((ref) => ({ label: ref.host, count: ref.count })), "Прямые заходы или нет внешних источников.");
  renderAnalyticsList("#admin-analytics-events", "События", topEvents.map((evt) => ({ label: analyticsEventLabel(evt.type), count: evt.count })), "Событий пока нет.");
}

async function loadAdminAnalytics() {
  const metrics = document.querySelector("#admin-analytics-metrics");
  if (!metrics) return;
  if (!authSession.accessToken || !isOwnerAdmin()) {
    metrics.innerHTML = `<article><strong>—</strong><span>нужен вход OWNER/ADMIN</span></article>`;
    return;
  }
  const range = Number(document.querySelector("#admin-analytics-range")?.value || 30) || 30;
  try {
    renderAdminAnalytics(await apiFetch(`/analytics/summary?days=${range}`));
  } catch {
    metrics.innerHTML = `<article><strong>—</strong><span>не удалось загрузить</span></article>`;
  }
}

document.querySelector("#admin-analytics-range")?.addEventListener("change", () => loadAdminAnalytics());

function normalizeAdminTab(tab = "overview") {
  const value = String(tab || "overview").trim().toLowerCase();
  const allowed = new Set(["overview", "users", "catalog", "ads", "launch", "premium", "seo", "audit", "analytics"]);
  if (!allowed.has(value)) return "overview";
  if (adminOwnerTabs.has(value) && !isOwnerAdmin()) return "overview";
  return value;
}

function applyAdminTab(tab = activeAdminTab, options = {}) {
  const normalized = normalizeAdminTab(tab);
  activeAdminTab = normalized;
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const active = button.dataset.adminTab === normalized;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.classList.toggle("is-admin-panel-hidden", panel.dataset.adminPanel !== normalized);
  });
  if (options.updateHistory !== false && currentViewName() === "admin") {
    const targetUrl = adminUrl(normalized);
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (currentUrl !== targetUrl) history[options.replace ? "replaceState" : "pushState"]({ view: "admin", tab: normalized }, "", targetUrl);
  }
  if (options.load !== false) loadAdminTab(normalized, { force: options.force === true });
}

async function loadAdminTab(tab = activeAdminTab, options = {}) {
  const normalized = normalizeAdminTab(tab);
  if (!authSession.accessToken || !isStaff()) {
    updateAdminRoleNote();
    return;
  }
  if (!options.force && adminLoadedTabs.has(normalized)) return;
  if (normalized === "overview") {
    await loadAdminDashboard();
  } else if (normalized === "users") {
    await loadAdminUsers();
  } else if (normalized === "catalog") {
    await Promise.all([loadAdminTags(), loadAdminGenres(), loadAdminFandoms(), loadAdminCharacters()]);
  } else if (normalized === "ads") {
    await loadAdminAds();
  } else if (normalized === "launch") {
    await loadAdminSettings();
  } else if (normalized === "premium") {
    await Promise.all([loadAdminPlans(), loadAdminFinance()]);
  } else if (normalized === "seo") {
    await loadAdminSeoPages();
  } else if (normalized === "analytics" && isOwnerAdmin()) {
    await loadAdminAnalytics();
  } else if (normalized === "audit" && isOwnerAdmin()) {
    try {
      renderAuditLog(await apiFetch("/admin/audit-log"));
    } catch {
      renderAuditLog([]);
    }
  }
  adminLoadedTabs.add(normalized);
}

async function loadAdminDashboard() {
  const tbody = document.querySelector("#admin-queue");
  if (!tbody) return;
  if (!authSession.accessToken) {
    updateAdminRoleNote();
    tbody.innerHTML = `<tr><td colspan="4">Войдите как owner/admin/moderator, чтобы увидеть реальные данные.</td></tr>`;
    return;
  }
  if (!isStaff()) {
    updateAdminRoleNote();
    tbody.innerHTML = `<tr><td colspan="4">У текущего пользователя нет доступа к админке.</td></tr>`;
    return;
  }
  updateAdminRoleNote();
  try {
    const [dashboard, reports, suggestions, adminListings] = await Promise.all([
      apiFetch("/admin/dashboard"),
      apiFetch("/admin/reports"),
      apiFetch("/admin/suggestions"),
      apiFetch("/admin/listings")
    ]);
    renderAdminMetrics(dashboard);
    renderAdminQueue({ reports, suggestions, listings: adminListings });
    adminLoadedTabs.add("overview");
  } catch {
    tbody.innerHTML = `<tr><td colspan="4">Не удалось загрузить данные админ-панели. Проверьте доступ и попробуйте позже.</td></tr>`;
  }
}

async function hydrateFromApi() {
  // If the API itself is unreachable, the whole page degrades — including chat.
  let ready;
  try {
    ready = await apiFetch("/health/ready");
  } catch (error) {
    chatAvailability = "unavailable";
    chatErrorCode = error?.status ? `API_${error.status}` : "API_UNREACHABLE";
    messages = [];
    chatHasMore = false;
    renderMessages({ stickToBottom: false });
    updateChatHistoryControls();
    updateChatComposerState();
    setApiStatus(false, "Сервис временно недоступен");
    return;
  }
  chatRealtimeReady = ready.dependencies?.realtime?.ok !== false;
  const readinessLabel = ready.ok
    ? "Сервис доступен"
    : `Сервис частично недоступен: ${[
        ready.dependencies?.database?.ok ? null : "DB",
        ready.dependencies?.meilisearch?.ok ? null : "search",
        chatRealtimeReady ? null : "realtime"
      ].filter(Boolean).join("+") || "попробуйте позже"}`;
  const listingQuery = feedQueryString();
  // Each endpoint is fetched independently so that ONE failing endpoint never
  // takes down the chat (or the rest of the page). Chat availability is gated
  // only by /chat/messages.
  const safe = (promise, fallback) => promise.catch(() => fallback);
  let chatError = null;
  const [settings, remoteListings, remoteMessages, plans, tags, genres, fandoms, characters, ads] = await Promise.all([
    safe(apiFetch("/settings"), {}),
    safe(apiFetch(`/search/listings${listingQuery ? `?${listingQuery}` : ""}`), { items: [] }),
    apiFetch("/chat/messages").catch((error) => { chatError = error; return null; }),
    safe(apiFetch("/subscription/plans"), []),
    safe(apiFetch("/tags"), []),
    safe(apiFetch("/genres"), []),
    safe(apiFetch("/fandoms"), []),
    safe(apiFetch("/characters"), []),
    safe(apiFetch("/ads/placements"), [])
  ]);
  featureFlags = { ...featureFlags, ...(settings || {}) };
  applyFeatureFlags();
  if (chatError) {
    chatAvailability = "unavailable";
    chatErrorCode = chatError?.status ? `CHAT_API_${chatError.status}` : "CHAT_API_UNREACHABLE";
    messages = [];
    chatHasMore = false;
  } else {
    chatAvailability = "ready";
    chatErrorCode = null;
    const remoteChatMessages = Array.isArray(remoteMessages) ? remoteMessages : [];
    messages = remoteChatMessages.slice().reverse().map(normalizeMessage);
    chatHasMore = remoteChatMessages.length >= chatPageSize;
  }
  try {
    const feedEnvelope = normalizeListingEnvelope(remoteListings);
    listings = feedEnvelope.items.map(normalizeListing);
    feedApiLoaded = true;
    feedServerPagination = feedEnvelope.pagination;
    catalogGenres = genres || [];
    catalogFandoms = fandoms || [];
    catalogCharacters = characters || [];
    renderPlans(plans || []);
    renderCatalogCloud(tags || []);
    renderListingTagControls();
    renderFeedCatalogFilters();
    renderAds(ads || []);
    renderListings();
    const current = listings.find((listing) => String(listing.id) === String(selectedListing?.id));
    renderListingDetail(current || listings[0]);
  } catch (error) {
    console.error("hydrate processing error", error);
  }
  renderMessages();
  updateChatComposerState();
  setApiStatus(true, readinessLabel, ready.ok ? "online" : "partial");
  updateSeo(currentViewName());
  if (deepLinkRoute?.type === "listing") {
    const route = deepLinkRoute;
    deepLinkRoute = null;
    openListing(route.value);
  } else if (deepLinkRoute?.type === "profile") {
    const route = deepLinkRoute;
    deepLinkRoute = null;
    openProfile(route.value, { listingsPage: route.listingsPage || 1, q: route.q || "", sort: route.sort || "new", updateHistory: false });
  }
  if (authSession.accessToken) {
    try {
      await loadInbox();
      loadAdminDashboard();
    } catch {
      // Inbox remains on static demo content when the token is stale.
    }
  }
}

function isCurrentLoadedUser(me) {
  if (!authSession.accessToken) return false;
  const current = authSession.user || {};
  if (current.id && me?.id) return String(current.id) === String(me.id);
  if (current.email && me?.email) return String(current.email).toLowerCase() === String(me.email).toLowerCase();
  return true;
}

async function loadMe() {
  const accessTokenAtStart = authSession.accessToken;
  if (!accessTokenAtStart) return;
  let me;
  try {
    me = await apiFetch("/auth/me");
  } catch {
    if (authSession.accessToken === accessTokenAtStart) clearSession();
    return;
  }
  if (!isCurrentLoadedUser(me)) return;
  authSession.user = { id: me.id, email: me.email, role: me.role, status: me.status, profile: me.profile, isPremium: me.isPremium };
  localStorage.setItem("cofindUser", JSON.stringify(authSession.user));
  updateAuthUi();
  renderSubscriptionStatus(me.subscription, authSession.user);
  renderAds();

  const blocksPromise = loadBlocks({ force: true });
  const hasMeDashboard = Boolean(document.querySelector("#me-display-name"));
  if (!hasMeDashboard) {
    await blocksPromise;
    loadAdminDashboard();
    return;
  }

  try {
    const [publicProfile, myListings, likedListings, sentResponses, incomingResponses, notifications, blocks] = await Promise.all([
      me.profile?.username ? apiFetch(`/profiles/${encodeURIComponent(me.profile.username)}`).catch(() => null) : null,
      apiFetch("/listings/mine").catch(() => []),
      apiFetch("/me/liked-listings").catch(() => []),
      apiFetch("/listings/mine/responses").catch(() => []),
      apiFetch("/listings/mine/incoming-responses").catch(() => []),
      apiFetch("/notifications").catch(() => []),
      blocksPromise
    ]);
    if (!isCurrentLoadedUser(me)) return;
    renderMeDashboard({ me, publicProfile, myListings, likedListings, sentResponses, incomingResponses, notifications, blocks });
    applyEmailNotificationSettings(me);
    loadAdminDashboard();
  } catch {
    showToast("Не удалось обновить часть данных личного кабинета");
  }
}

["#feed-search", "#feed-type", "#feed-rating", "#feed-genre", "#feed-fandom", "#feed-character", "#feed-open", "#feed-new"].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("input", scheduleFeedRefresh);
  document.querySelector(selector)?.addEventListener("change", scheduleFeedRefresh);
});

document.querySelector("#feed-quick-filters")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-feed-quick]");
  if (!button) return;
  applyFeedQuickFilter(button.dataset.feedQuick || "all");
});

document.querySelector("#feed-filter-toggle")?.addEventListener("click", () => toggleFeedFilters());

document.querySelector("#save-feed-filters")?.addEventListener("click", () => {
  persistFeedFilters();
  showToast("Фильтры ленты сохранены");
});

document.querySelector("#reset-feed-filters")?.addEventListener("click", () => {
  resetFeedFilters();
  showToast("Фильтры ленты сброшены");
});

document.querySelector("#feed-pagination")?.addEventListener("click", (event) => {
  const link = event.target.closest("[data-feed-page]");
  if (!link) return;
  if (shouldUseNativeNavigation(event, link)) return;
  event.preventDefault();
  goToFeedPage(link.dataset.feedPage);
});

document.querySelector("#feed-active-filters")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-feed-filter]");
  if (!button) return;
  removeFeedFilter(button.dataset.removeFeedFilter);
});

document.querySelectorAll("[data-sort]").forEach((button) => {
  button.addEventListener("click", () => {
    setFeedSort(button.dataset.sort);
    feedPage = 1;
    persistFeedFilters({ silent: true });
    if (apiOnline) {
      scheduleFeedRefresh();
    } else {
      syncFeedUrl();
      renderListings();
    }
  });
});

document.querySelector("#catalog-cloud")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-catalog-tag]");
  if (!button) return;
  document.querySelector("#feed-search").value = button.dataset.catalogTag;
  feedPage = 1;
  setView("feed");
  scheduleFeedRefresh();
});

document.querySelector("#home-live-listings")?.addEventListener("click", (event) => {
  const profileLink = event.target.closest("[data-open-profile]");
  if (profileLink) {
    if (shouldUseNativeNavigation(event, profileLink)) return;
    event.preventDefault();
    openProfile(profileLink.dataset.openProfile);
    return;
  }
  const card = event.target.closest("[data-open-listing]");
  if (card) {
    if (shouldUseNativeNavigation(event, card)) return;
    event.preventDefault();
    openListing(card.dataset.openListing);
  }
});

document.querySelector("#home-live-listings")?.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const card = event.target.closest("[data-open-listing]");
  if (!card) return;
  event.preventDefault();
  openListing(card.dataset.openListing);
});

document.querySelector("#home-recent-listings")?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-open-listing]");
  if (!card) return;
  if (shouldUseNativeNavigation(event, card)) return;
  event.preventDefault();
  openListing(card.dataset.openListing);
});

document.querySelector("#home-recent-listings")?.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const card = event.target.closest("[data-open-listing]");
  if (!card) return;
  event.preventDefault();
  openListing(card.dataset.openListing);
});

document.querySelector("#clear-recent-listings")?.addEventListener("click", () => {
  recentListings = [];
  localStorage.removeItem(recentListingsKey);
  renderRecentListings();
  showToast("История просмотра очищена");
});

document.querySelector("#home-live-chat")?.addEventListener("click", (event) => {
  const profileLink = event.target.closest("[data-open-profile]");
  if (profileLink) {
    if (shouldUseNativeNavigation(event, profileLink)) return;
    event.preventDefault();
    openProfile(profileLink.dataset.openProfile);
    return;
  }
  const chatMessage = event.target.closest("[data-open-chat-room]");
  if (!chatMessage) return;
  event.preventDefault();
  openAppPath(chatUrl(chatMessage.dataset.openChatRoom || "general"));
});

document.querySelector("#home-live-chat")?.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const chatMessage = event.target.closest("[data-open-chat-room]");
  if (!chatMessage) return;
  event.preventDefault();
  openAppPath(chatUrl(chatMessage.dataset.openChatRoom || "general"));
});

document.querySelector("#inbox-tabs")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-inbox-filter]");
  if (!button) return;
  setInboxFilter(button.dataset.inboxFilter || "all");
});

document.querySelector("#inbox-search")?.addEventListener("input", () => renderInbox(inboxPayload));
document.querySelector("#inbox-sort")?.addEventListener("change", () => renderInbox(inboxPayload));

document.querySelector("#listing-list")?.addEventListener("click", async (event) => {
  const profileLink = event.target.closest("[data-open-profile]");
  const openButton = event.target.closest("[data-open-listing]");
  const likeButton = event.target.closest("[data-like-feed]");
  if (profileLink) {
    if (shouldUseNativeNavigation(event, profileLink)) return;
    event.preventDefault();
    openProfile(profileLink.dataset.openProfile);
    return;
  }
  if (openButton) {
    if (shouldUseNativeNavigation(event, openButton)) return;
    event.preventDefault();
    openListing(openButton.dataset.openListing);
    return;
  }
  const emptyAction = event.target.closest("[data-empty-feed-action]");
  if (emptyAction) {
    event.preventDefault();
    if (emptyAction.dataset.emptyFeedAction === "reset") resetFeedFilters();
    if (emptyAction.dataset.emptyFeedAction === "suggest") setView("suggestions");
  }
  if (likeButton) {
    const remoteItem = listings.find((listing) => String(listing.id) === String(likeButton.dataset.likeFeed));
    if (!remoteItem || !requireAuthForAction("Чтобы поставить лайк заявке, войдите в аккаунт")) return;
    if (listingIsFromBlockedAuthor(remoteItem)) {
      showToast("Заявка принадлежит заблокированному автору.");
      renderListings();
      return;
    }
    if (pendingListingLikes.has(remoteItem.id)) return;
    pendingListingLikes.add(remoteItem.id);
    likeButton.disabled = true;
    try {
      const result = await apiFetch(`/listings/${remoteItem.id}/like`, { method: "POST" });
      const likes = typeof result.likes === "number" ? result.likes : Math.max(0, (remoteItem.likes || 0) + (result.liked ? 1 : -1));
      syncListingLikeState(remoteItem.id, likes, Boolean(result.liked));
      showToast(result.liked ? "Лайк добавлен" : "Лайк снят");
    } catch (error) {
      showToast(apiFailure("Не удалось изменить лайк", error));
    } finally {
      pendingListingLikes.delete(remoteItem.id);
      likeButton.disabled = false;
    }
    if (remoteItem) {
      renderListings();
    }
  }
});

document.querySelector("#public-profile-listings")?.addEventListener("click", (event) => {
  const profileLink = event.target.closest("[data-open-profile]");
  const openButton = event.target.closest("[data-open-listing]");
  if (profileLink) {
    if (shouldUseNativeNavigation(event, profileLink)) return;
    event.preventDefault();
    openProfile(profileLink.dataset.openProfile);
    return;
  }
  if (openButton) {
    if (shouldUseNativeNavigation(event, openButton)) return;
    event.preventDefault();
    openListing(openButton.dataset.openListing);
  }
});

document.querySelector("#my-listing-tabs")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-my-listing-filter]");
  if (!button) return;
  activeMyListingsFilter = ["all", "DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"].includes(button.dataset.myListingFilter)
    ? button.dataset.myListingFilter
    : "all";
  renderMyListings(myListingsCache);
});

document.querySelector("#my-listings-search")?.addEventListener("input", () => renderMyListings(myListingsCache));
document.querySelector("#my-listings-sort")?.addEventListener("change", () => renderMyListings(myListingsCache));

document.querySelector("#my-listings")?.addEventListener("click", async (event) => {
  const emptyAction = event.target.closest("[data-my-listings-empty-action]");
  const editButton = event.target.closest("[data-edit-my-listing]");
  const openButton = event.target.closest("[data-open-my-listing]");
  const publishButton = event.target.closest("[data-publish-my-listing]");
  const closeButton = event.target.closest("[data-close-my-listing]");
  const archiveButton = event.target.closest("[data-archive-my-listing]");
  const deleteButton = event.target.closest("[data-delete-my-listing]");

  if (emptyAction) {
    if (emptyAction.dataset.myListingsEmptyAction === "new") {
      resetListingEditor();
      setView("new-listing");
    } else {
      activeMyListingsFilter = "all";
      renderMyListings(myListingsCache);
    }
    return;
  }

  if (editButton) {
    const item = myListingsCache.find((listing) => String(listing.id) === String(editButton.dataset.editMyListing));
    if (item) editListingInForm(item);
    return;
  }

  if (openButton) {
    const item = myListingsCache.find((listing) => String(listing.id) === String(openButton.dataset.openMyListing));
    if (item) {
      const listing = normalizeListing(item);
      renderListingDetail(listing);
      rememberRecentListing(listing);
      setView("listing", { url: `/listing/${encodeURIComponent(listing.id)}` });
    } else {
      openListing(openButton.dataset.openMyListing);
    }
    return;
  }

  const actionButton = publishButton || closeButton || archiveButton || deleteButton;
  if (!actionButton) return;
  const id = actionButton.dataset.publishMyListing || actionButton.dataset.closeMyListing || actionButton.dataset.archiveMyListing || actionButton.dataset.deleteMyListing;
  const action = publishButton ? "publish" : closeButton ? "close" : archiveButton ? "archive" : "delete";
  const messages = {
    publish: "Заявка отправлена на модерацию",
    close: "Заявка закрыта",
    archive: "Заявка отправлена в архив",
    delete: "Заявка удалена"
  };
  if (deleteButton && !confirm("Удалить заявку? Она исчезнет из ЛК и публичных списков.")) return;
  actionButton.disabled = true;
  try {
    await apiFetch(`/listings/${id}/${action}`, { method: "POST" });
    showToast(messages[action]);
    await Promise.all([loadMe(), refreshFeedFromApi()]);
  } catch (error) {
    showToast(apiFailure("Не удалось выполнить действие с заявкой", error));
    actionButton.disabled = false;
  }
});

document.querySelector("#liked-listings")?.addEventListener("click", async (event) => {
  const profileLink = event.target.closest("[data-open-profile]");
  const openButton = event.target.closest("[data-open-listing]");
  const likeButton = event.target.closest("[data-like-feed]");
  if (profileLink) {
    if (shouldUseNativeNavigation(event, profileLink)) return;
    event.preventDefault();
    openProfile(profileLink.dataset.openProfile);
    return;
  }
  if (openButton) {
    if (shouldUseNativeNavigation(event, openButton)) return;
    event.preventDefault();
    openListing(openButton.dataset.openListing);
  }
  if (likeButton) {
    event.preventDefault();
    const remoteItem = listings.find((listing) => String(listing.id) === String(likeButton.dataset.likeFeed)) || { id: likeButton.dataset.likeFeed };
    if (!requireAuthForAction("Чтобы изменить лайк, войдите в аккаунт")) return;
    if (pendingListingLikes.has(remoteItem.id)) return;
    pendingListingLikes.add(remoteItem.id);
    likeButton.disabled = true;
    try {
      const result = await apiFetch(`/listings/${remoteItem.id}/like`, { method: "POST" });
      if (typeof result.likes === "number") syncListingLikeState(remoteItem.id, result.likes, Boolean(result.liked));
      await loadMe();
      showToast(result.liked ? "Лайк добавлен" : "Заявка убрана из понравившихся");
    } catch (error) {
      showToast(apiFailure("Не удалось изменить лайк", error));
    } finally {
      pendingListingLikes.delete(remoteItem.id);
      likeButton.disabled = false;
    }
  }
});

document.querySelector("#liked-listings-search")?.addEventListener("input", () => renderLikedListings(likedListingsCache));
document.querySelector("#liked-listings-sort")?.addEventListener("change", () => renderLikedListings(likedListingsCache));

document.querySelector("#listing-selected-tags")?.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-listing-tag]");
  if (!removeButton) return;
  selectedListingTagSlugs = selectedListingTagSlugs.filter((slug) => slug !== removeButton.dataset.removeListingTag);
  renderListingTagControls();
  scheduleListingDraftSave();
});

document.querySelector("#listing-selected-genres")?.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-listing-genre]");
  if (!removeButton) return;
  selectedListingGenreSlugs = selectedListingGenreSlugs.filter((slug) => slug !== removeButton.dataset.removeListingGenre);
  renderListingTagControls();
  scheduleListingDraftSave();
});

document.querySelector("#listing-selected-fandoms")?.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-listing-fandom]");
  if (!removeButton) return;
  selectedListingFandomSlugs = selectedListingFandomSlugs.filter((slug) => slug !== removeButton.dataset.removeListingFandom);
  renderListingTagControls();
  scheduleListingDraftSave();
});

document.querySelector("#listing-selected-characters")?.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-listing-character]");
  if (!removeButton) return;
  selectedListingCharacterSlugs = selectedListingCharacterSlugs.filter((slug) => slug !== removeButton.dataset.removeListingCharacter);
  renderListingTagControls();
  scheduleListingDraftSave();
});

function addListingCatalogItem({ inputSelector, catalog, getSelected, setSelected, missingMessage }) {
  const input = document.querySelector(inputSelector);
  const item = findCatalogItem(catalog, input.value);
  if (!item) {
    showToast(missingMessage);
    return;
  }
  const selected = getSelected();
  if (!selected.includes(item.slug)) {
    setSelected([...selected, item.slug]);
    renderListingTagControls();
    scheduleListingDraftSave();
  }
  input.value = "";
}

function addListingTagFromInput() {
  addListingCatalogItem({
    inputSelector: "#suggestion-input",
    catalog: catalogTags,
    getSelected: () => selectedListingTagSlugs,
    setSelected: (next) => { selectedListingTagSlugs = next; },
    missingMessage: "Такого тега нет в каталоге. Можно отправить предложение."
  });
}

function addListingGenreFromInput() {
  addListingCatalogItem({
    inputSelector: "#listing-genre-input",
    catalog: catalogGenres,
    getSelected: () => selectedListingGenreSlugs,
    setSelected: (next) => { selectedListingGenreSlugs = next; },
    missingMessage: "Такого жанра нет в каталоге. Можно отправить предложение."
  });
}

function addListingFandomFromInput() {
  addListingCatalogItem({
    inputSelector: "#listing-fandom-input",
    catalog: catalogFandoms,
    getSelected: () => selectedListingFandomSlugs,
    setSelected: (next) => { selectedListingFandomSlugs = next; },
    missingMessage: "Такого фандома нет в каталоге. Можно отправить предложение."
  });
}

function addListingCharacterFromInput() {
  addListingCatalogItem({
    inputSelector: "#listing-character-input",
    catalog: catalogCharacters,
    getSelected: () => selectedListingCharacterSlugs,
    setSelected: (next) => { selectedListingCharacterSlugs = next; },
    missingMessage: "Такого персонажа нет в каталоге. Можно отправить предложение."
  });
}

document.querySelector("#add-listing-tag")?.addEventListener("click", addListingTagFromInput);
document.querySelector("#add-listing-genre")?.addEventListener("click", addListingGenreFromInput);
document.querySelector("#add-listing-fandom")?.addEventListener("click", addListingFandomFromInput);
document.querySelector("#add-listing-character")?.addEventListener("click", addListingCharacterFromInput);
document.querySelector("#suggestion-input")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addListingTagFromInput();
});
document.querySelector("#listing-genre-input")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addListingGenreFromInput();
});
document.querySelector("#listing-fandom-input")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addListingFandomFromInput();
});
document.querySelector("#listing-character-input")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addListingCharacterFromInput();
});

document.querySelector("#inbox-list")?.addEventListener("click", async (event) => {
  const acceptButton = event.target.closest("[data-accept-response]");
  const declineButton = event.target.closest("[data-decline-response]");
  const listingButton = event.target.closest("[data-open-listing-from-inbox]");
  const conversationButton = event.target.closest("[data-open-conversation]");
  const conversationRow = event.target.closest("[data-conversation-id]");

  if (acceptButton) {
    try {
      await apiFetch(`/listings/responses/${acceptButton.dataset.acceptResponse}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "ACCEPTED" })
      });
      showToast("Отклик принят, диалог создан или обновлен");
      await loadInbox();
    } catch (error) {
      showToast(apiFailure("Не удалось принять отклик", error));
    }
  }

  if (declineButton) {
    try {
      await apiFetch(`/listings/responses/${declineButton.dataset.declineResponse}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "DECLINED" })
      });
      showToast("Отклик отклонен");
      await loadInbox();
    } catch (error) {
      showToast(apiFailure("Не удалось отклонить отклик", error));
    }
  }

  if (listingButton) {
    openListing(listingButton.dataset.openListingFromInbox);
  }

  if (conversationButton) {
    openPrivateConversation(conversationButton.dataset.openConversation);
  } else if (conversationRow && !event.target.closest("button")) {
    openPrivateConversation(conversationRow.dataset.conversationId);
  }
});

renderFeedCatalogFilters();
restoreFeedFilters();
renderListings();
renderListingDetail(listings[0]);
renderListingTagControls();
restoreListingDraft();
loadRecentListings();
updateSuggestionFormState();
updateReportFormState();

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await logoutBeforeAuthSubmit();
    const session = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#login-email").value,
        password: document.querySelector("#login-password").value
      })
    });
    saveSession(session);
    showToast("Вы вошли в Cofind 2");
    completeAuthRedirect("me");
  } catch (error) {
    showToast(apiFailure("Не удалось войти", error));
  }
});

document.querySelector("#register-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const session = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#register-email").value,
        username: document.querySelector("#register-username").value,
        displayName: document.querySelector("#register-display").value,
        password: document.querySelector("#register-password").value
      })
    });
    saveSession(session);
    showToast("Аккаунт создан");
    completeAuthRedirect("me");
  } catch (error) {
    showToast(apiFailure("Регистрация не прошла", error));
  }
});

document.querySelector("#reset-request-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#reset-email").value.trim();
  const note = document.querySelector("#reset-note");
  try {
    const result = await apiFetch("/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    if (result.resetToken) {
      document.querySelector("#reset-token").value = result.resetToken;
      note.textContent = "Dev token получен. Проверьте новый пароль и сохраните его.";
    } else {
      note.textContent = "Если e-mail есть в системе, мы отправим инструкции восстановления.";
    }
    showToast("Запрос восстановления принят");
  } catch (error) {
    showToast(apiFailure("Не удалось запросить восстановление", error));
  }
});

document.querySelector("#reset-confirm-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = document.querySelector("#reset-token").value.trim();
  const newPassword = document.querySelector("#reset-new-password").value;
  try {
    await apiFetch("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword })
    });
    event.currentTarget.reset();
    document.querySelector("#reset-note").textContent = "Пароль обновлен. Теперь войдите по e-mail.";
    showToast("Пароль обновлен");
    setAuthMode("login");
    document.querySelector("#login-email").value = document.querySelector("#reset-email").value.trim();
  } catch (error) {
    showToast(apiFailure("Не удалось обновить пароль", error));
  }
});

logoutButton?.addEventListener("click", clearSession);
document.querySelector("#admin-refresh")?.addEventListener("click", () => loadAdminTab("overview", { force: true }));
document.querySelector("#view-admin")?.addEventListener("click", (event) => {
  const tabButton = event.target.closest("[data-admin-tab]");
  if (!tabButton) return;
  applyAdminTab(tabButton.dataset.adminTab, { updateHistory: true, load: true });
});
document.querySelector("#admin-queue-search")?.addEventListener("input", () => renderAdminQueue(adminQueueCache));
document.querySelector("#admin-queue-kind")?.addEventListener("change", () => renderAdminQueue(adminQueueCache));
document.querySelector("#admin-queue-status")?.addEventListener("change", () => renderAdminQueue(adminQueueCache));
document.querySelector("#admin-users-search")?.addEventListener("input", () => renderAdminUsers(adminUsersCache));
document.querySelector("#admin-users-role")?.addEventListener("change", () => renderAdminUsers(adminUsersCache));
document.querySelector("#admin-users-status")?.addEventListener("change", () => renderAdminUsers(adminUsersCache));
document.querySelector("#refresh-my-suggestions")?.addEventListener("click", () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы обновить предложения, войдите в аккаунт", "suggestions");
    return;
  }
  loadMySuggestions();
});
document.querySelector("#my-suggestions-search")?.addEventListener("input", () => renderMySuggestions(mySuggestionsCache));
document.querySelector("#my-suggestions-status")?.addEventListener("change", () => renderMySuggestions(mySuggestionsCache));
document.querySelector("#refresh-my-reports")?.addEventListener("click", () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы обновить жалобы, войдите в аккаунт", "report");
    return;
  }
  loadMyReports();
});
document.querySelector("#my-reports-search")?.addEventListener("input", () => renderMyReports(myReportsCache));
document.querySelector("#my-reports-status")?.addEventListener("change", () => renderMyReports(myReportsCache));
document.querySelector("#refresh-my-listings")?.addEventListener("click", () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы обновить ЛК, войдите в аккаунт", "me");
    return;
  }
  loadMe();
});
document.querySelector("#refresh-liked-listings")?.addEventListener("click", () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы обновить понравившиеся заявки, войдите в аккаунт", "me");
    return;
  }
  loadMe();
});

document.querySelector("#profile-readiness-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-readiness-action]");
  if (!button) return;
  const action = button.dataset.readinessAction;
  if (action === "profile") {
    document.querySelector("#profile-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#profile-display-name")?.focus();
    return;
  }
  if (action === "new-listing") {
    resetListingEditor();
    setView("new-listing");
    return;
  }
  if (action === "inbox") {
    setView("inbox");
  }
});

document.querySelector("#account-role-cards")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role-action]");
  if (!button) return;
  const action = button.dataset.roleAction;
  if (action === "profile") {
    document.querySelector("#profile-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("#profile-display-name")?.focus();
    return;
  }
  if (action === "new-listing") {
    resetListingEditor();
    setView("new-listing");
    return;
  }
  setView(action);
});

document.querySelector("#open-my-public-profile")?.addEventListener("click", () => {
  const username = authSession.user?.profile?.username;
  if (!username) {
    showToast("У профиля пока нет публичного username");
    return;
  }
  openProfile(username);
});

document.querySelector("#copy-my-profile-link")?.addEventListener("click", () => {
  const username = authSession.user?.profile?.username;
  if (!username) {
    showToast("У профиля пока нет публичного username");
    return;
  }
  copyToClipboard(`${location.origin}/profile/${encodeURIComponent(username)}`, "Ссылка на ваш профиль скопирована");
});

document.querySelector("#suggestion-form")?.addEventListener("input", updateSuggestionFormState);
document.querySelector("#suggestion-form")?.addEventListener("change", updateSuggestionFormState);

document.querySelector("#suggestion-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  updateSuggestionFormState();
  const title = document.querySelector("#suggestion-title-input").value.trim();
  const description = document.querySelector("#suggestion-description-input").value.trim();
  const sourceUrl = document.querySelector("#suggestion-source-input").value.trim();
  if (title.length < 2 || title.length > 120 || description.length > 2000 || (sourceUrl && !/^https?:\/\//i.test(sourceUrl))) {
    showToast("Проверьте название, описание и ссылку предложения");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы отправить предложение, войдите в аккаунт", "suggestions");
    return;
  }
  const payload = {
    type: document.querySelector("#suggestion-type").value,
    title,
    description: description || undefined,
    sourceUrl: sourceUrl || undefined
  };
  try {
    await apiFetch("/suggestions", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    updateSuggestionFormState();
    showToast("Предложение отправлено на модерацию");
    loadMySuggestions();
    loadAdminDashboard();
  } catch (error) {
    showToast(apiFailure("Не удалось отправить предложение", error));
  }
});

document.querySelector("#report-form")?.addEventListener("input", updateReportFormState);
document.querySelector("#report-form")?.addEventListener("change", updateReportFormState);

document.querySelector("#report-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  event.currentTarget.dataset.validationShown = "true";
  const isValid = updateReportFormState({ showErrors: true });
  const entityId = document.querySelector("#report-entity-id").value.trim();
  const comment = document.querySelector("#report-comment").value.trim();
  if (!isValid) {
    showToast("Проверьте объект и комментарий жалобы");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы отправить жалобу, войдите в аккаунт", "report");
    return;
  }
  const payload = {
    entityType: document.querySelector("#report-entity-type").value,
    entityId,
    reason: document.querySelector("#report-reason").value,
    comment: comment || undefined
  };
  try {
    await apiFetch("/reports", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    delete event.currentTarget.dataset.validationShown;
    updateReportFormState();
    showToast("Жалоба отправлена модераторам");
    loadMyReports();
    loadAdminDashboard();
  } catch (error) {
    showToast(apiFailure("Не удалось отправить жалобу", error));
  }
});

document.querySelector("#profile-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы сохранить профиль, войдите в аккаунт", "me");
    return;
  }
  const payload = {
    displayName: document.querySelector("#profile-display-name").value.trim(),
    bio: document.querySelector("#profile-bio").value.trim() || undefined,
    avatarUrl: selectedAvatarUrl || null,
    coverImageUrl: selectedCoverUrl || null,
    writingStyle: document.querySelector("#profile-writing-style").value.trim() || undefined,
    literacyLevel: document.querySelector("#profile-literacy-level").value.trim() || undefined,
    preferredPostLength: document.querySelector("#profile-post-length").value.trim() || undefined,
    activityLevel: document.querySelector("#profile-activity-level").value.trim() || undefined,
    communicationPreferences: document.querySelector("#profile-communication").value.trim() || undefined,
    favoriteGenres: splitCommaList(document.querySelector("#profile-favorite-genres").value),
    favoriteFandoms: splitCommaList(document.querySelector("#profile-favorite-fandoms").value),
    favoriteCharacters: splitCommaList(document.querySelector("#profile-favorite-characters").value),
    socialWebsite: document.querySelector("#profile-social-website").value.trim(),
    socialTelegram: document.querySelector("#profile-social-telegram").value.trim(),
    socialDiscord: document.querySelector("#profile-social-discord").value.trim(),
    showLastSeen: document.querySelector("#profile-show-last-seen").checked,
    allowProfileMessages: document.querySelector("#profile-allow-messages").checked
  };
  try {
    await apiFetch("/me/profile", { method: "PATCH", body: JSON.stringify(payload) });
    showToast("Профиль сохранен");
    await loadMe();
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить профиль", error));
  }
});

document.querySelector("#public-profile-listing-search")?.addEventListener("input", () => {
  publicProfileListingsQuery = document.querySelector("#public-profile-listing-search")?.value.trim() || "";
  publicProfileListingsPage = 1;
  clearTimeout(publicProfileListingsTimer);
  publicProfileListingsTimer = setTimeout(() => {
    if (currentProfileUsername && apiOnline) {
      openProfile(currentProfileUsername, { listingsPage: 1, q: publicProfileListingsQuery, sort: publicProfileListingsSort });
    } else {
      renderPublicProfileListings();
    }
  }, 250);
});
document.querySelector("#public-profile-listing-sort")?.addEventListener("change", () => {
  publicProfileListingsQuery = document.querySelector("#public-profile-listing-search")?.value.trim() || "";
  publicProfileListingsSort = document.querySelector("#public-profile-listing-sort")?.value || "new";
  publicProfileListingsPage = 1;
  if (currentProfileUsername && apiOnline) {
    openProfile(currentProfileUsername, { listingsPage: 1, q: publicProfileListingsQuery, sort: publicProfileListingsSort });
  } else {
    renderPublicProfileListings();
  }
});
document.querySelector("#public-profile-listings-pagination")?.addEventListener("click", (event) => {
  const link = event.target.closest("[data-profile-listings-page]");
  if (!link) return;
  if (shouldUseNativeNavigation(event, link)) return;
  event.preventDefault();
  publicProfileListingsPage = Math.max(1, Number(link.dataset.profileListingsPage || 1));
  if (currentProfileUsername && apiOnline) {
    openProfile(currentProfileUsername, { listingsPage: publicProfileListingsPage, q: publicProfileListingsQuery, sort: publicProfileListingsSort });
  } else {
    renderPublicProfileListings();
  }
  document.querySelector("#public-profile-listings")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы сменить пароль, войдите в аккаунт", "me");
    return;
  }
  const currentPassword = document.querySelector("#current-password").value;
  const newPassword = document.querySelector("#new-password").value;
  if (newPassword.length < 8) {
    showToast("Новый пароль должен быть не короче 8 символов");
    return;
  }
  try {
    await apiFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    event.currentTarget.reset();
    document.querySelector("#password-note").textContent = "Пароль изменен. Текущая сессия остается активной.";
    showToast("Пароль изменен");
  } catch (error) {
    showToast(apiFailure("Не удалось сменить пароль", error));
  }
});

document.querySelector("#download-my-data")?.addEventListener("click", async () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы скачать данные, войдите в аккаунт", "me");
    return;
  }
  try {
    const data = await apiFetch("/me/export");
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJsonFile(`cofind-data-${stamp}.json`, data);
    showToast("Экспорт данных подготовлен");
  } catch (error) {
    showToast(apiFailure("Не удалось скачать данные", error));
  }
});

document.querySelector("#deactivate-account")?.addEventListener("click", async () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы деактивировать аккаунт, войдите в аккаунт", "me");
    return;
  }
  const passwordInput = document.querySelector("#deactivate-password");
  const password = passwordInput?.value || "";
  if (!password) {
    showToast("Введите пароль для подтверждения деактивации");
    passwordInput?.focus();
    return;
  }
  if (!confirm("Деактивировать аккаунт? Профиль и заявки будут скрыты, текущая сессия завершится.")) return;
  try {
    await apiFetch("/auth/deactivate", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    passwordInput.value = "";
    clearSession();
    setView("home");
    showToast("Аккаунт деактивирован");
  } catch (error) {
    showToast(apiFailure("Не удалось деактивировать аккаунт", error));
  }
});

document.querySelector("#profile-avatar-preset")?.addEventListener("change", (event) => {
  selectedAvatarUrl = safeAvatarUrl(event.currentTarget.value);
  const name = document.querySelector("#profile-display-name")?.value || authSession.user?.profile?.displayName || "Вы";
  setAvatarElement(document.querySelector("#profile-avatar-preview"), name, selectedAvatarUrl);
});

document.querySelector("#profile-avatar-file")?.addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const validationError = validateImageFile(file, "avatar");
  if (validationError) {
    showToast(validationError);
    event.currentTarget.value = "";
    return;
  }
  try {
    const dataUrl = await prepareImageDataUrl(file, "avatar");
    selectedAvatarUrl = dataUrl;
    document.querySelector("#profile-avatar-preset").value = "";
    const name = document.querySelector("#profile-display-name")?.value || authSession.user?.profile?.displayName || "Вы";
    setAvatarElement(document.querySelector("#profile-avatar-preview"), name, selectedAvatarUrl);
    if (authSession.accessToken && apiOnline) {
      try {
        const uploaded = await uploadImageDataUrl(dataUrl, "avatar");
        selectedAvatarUrl = uploaded.url;
        setAvatarElement(document.querySelector("#profile-avatar-preview"), name, selectedAvatarUrl);
        showToast("Аватар загружен в хранилище");
      } catch (error) {
        showToast(apiFailure("Не удалось загрузить аватар, оставляю локальное превью", error));
      }
    }
  } catch (error) {
    showToast(apiFailure("Не удалось прочитать аватар", error));
    event.currentTarget.value = "";
  }
});

document.querySelector("#profile-avatar-clear")?.addEventListener("click", () => {
  selectedAvatarUrl = "";
  document.querySelector("#profile-avatar-preset").value = "";
  document.querySelector("#profile-avatar-file").value = "";
  const name = document.querySelector("#profile-display-name")?.value || authSession.user?.profile?.displayName || "Вы";
  setAvatarElement(document.querySelector("#profile-avatar-preview"), name, "");
});

document.querySelector("#profile-cover-url")?.addEventListener("input", (event) => {
  selectedCoverUrl = safeImageUrl(event.currentTarget.value.trim());
  setCoverElement(document.querySelector("#profile-cover-preview"), selectedCoverUrl);
});

document.querySelector("#profile-cover-file")?.addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const validationError = validateImageFile(file, "cover");
  if (validationError) {
    showToast(validationError);
    event.currentTarget.value = "";
    return;
  }
  try {
    const dataUrl = await prepareImageDataUrl(file, "cover");
    selectedCoverUrl = dataUrl;
    document.querySelector("#profile-cover-url").value = "";
    setCoverElement(document.querySelector("#profile-cover-preview"), selectedCoverUrl);
    setCoverElement(document.querySelector("#me-profile-cover"), selectedCoverUrl);
    if (authSession.accessToken && apiOnline) {
      try {
        const uploaded = await uploadImageDataUrl(dataUrl, "cover");
        selectedCoverUrl = uploaded.url;
        document.querySelector("#profile-cover-url").value = uploaded.url;
        setCoverElement(document.querySelector("#profile-cover-preview"), selectedCoverUrl);
        setCoverElement(document.querySelector("#me-profile-cover"), selectedCoverUrl);
        showToast("Обложка загружена в хранилище");
      } catch (error) {
        showToast(apiFailure("Не удалось загрузить обложку, оставляю локальное превью", error));
      }
    }
  } catch (error) {
    showToast(apiFailure("Не удалось прочитать обложку", error));
    event.currentTarget.value = "";
  }
});

document.querySelector("#profile-cover-clear")?.addEventListener("click", () => {
  selectedCoverUrl = "";
  document.querySelector("#profile-cover-url").value = "";
  document.querySelector("#profile-cover-file").value = "";
  setCoverElement(document.querySelector("#profile-cover-preview"), "");
  setCoverElement(document.querySelector("#me-profile-cover"), "");
});

document.querySelector("#profile-display-name")?.addEventListener("input", (event) => {
  setAvatarElement(document.querySelector("#profile-avatar-preview"), event.currentTarget.value || "Вы", selectedAvatarUrl);
});

document.querySelector("#listing-form")?.addEventListener("input", () => {
  updateListingPreview();
  scheduleListingDraftSave();
});
document.querySelector("#listing-form")?.addEventListener("change", () => {
  updateListingPreview();
  scheduleListingDraftSave();
});

document.querySelector("#ai-draft-button")?.addEventListener("click", async () => {
  if (!aiEnabled()) return;
  const promptInput = document.querySelector("#ai-draft-prompt");
  const status = document.querySelector("#ai-draft-status");
  const button = document.querySelector("#ai-draft-button");
  const prompt = (promptInput?.value || "").trim();
  if (prompt.length < 3) {
    showToast("Опишите идею хотя бы парой слов");
    return;
  }
  if (button) button.disabled = true;
  if (status) status.textContent = "ИИ генерирует черновик…";
  try {
    const typeSelect = document.querySelector("#listing-type");
    const type = typeSelect?.value || undefined;
    const draft = await apiFetch("/ai/listing/draft", { method: "POST", body: JSON.stringify({ prompt, type }) });
    if (draft.title) {
      const titleInput = document.querySelector("#listing-title-input");
      if (titleInput) {
        titleInput.value = draft.title;
        titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (draft.body) {
      const bodyInput = document.querySelector("#listing-body-input");
      if (bodyInput) {
        bodyInput.value = draft.body;
        bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
        syncRichEditorFromTextarea("listing-body-input");
      }
    }
    const hints = [];
    if (draft.suggestedFandoms?.length) hints.push(`фандомы: ${draft.suggestedFandoms.join(", ")}`);
    if (draft.suggestedGenres?.length) hints.push(`жанры: ${draft.suggestedGenres.join(", ")}`);
    if (draft.suggestedTags?.length) hints.push(`теги: ${draft.suggestedTags.join(", ")}`);
    if (status) status.textContent = hints.length ? `Черновик готов. Подсказки — ${hints.join("; ")}. Проверьте и отредактируйте.` : "Черновик готов. Проверьте и отредактируйте перед публикацией.";
    updateListingFormState();
    updateListingPreview();
  } catch (error) {
    if (status) status.textContent = "";
    showToast(apiFailure("Не удалось сгенерировать черновик", error));
  } finally {
    if (button) button.disabled = false;
  }
});

// ---- ИИ-соигрок (RP with an AI partner) ----
let rpCurrentSessionId = null;

async function loadRpSessions() {
  if (!aiEnabled() || !authSession.accessToken) return;
  try {
    renderRpSessions(await apiFetch("/ai/rp/sessions"));
  } catch {
    renderRpSessions([]);
  }
}

function renderRpSessions(sessions = []) {
  const list = document.querySelector("#rp-session-list");
  if (!list) return;
  list.innerHTML = sessions.length
    ? sessions.map((session) => `<div class="rp-session-item${session.id === rpCurrentSessionId ? " is-active" : ""}" data-rp-open="${escapeHtml(session.id)}">
        <span class="rp-session-meta"><span class="rp-session-title">${escapeHtml(session.title)}</span>${session.fandom ? `<span class="rp-session-sub">${escapeHtml(session.fandom)}</span>` : ""}</span>
        <button type="button" class="rp-session-del" data-rp-delete="${escapeHtml(session.id)}" aria-label="Удалить сессию" title="Удалить">✕</button>
      </div>`).join("")
    : `<p class="muted-note">Пока нет сессий. Создайте первую.</p>`;
}

function rpShowForm() {
  rpCurrentSessionId = null;
  document.querySelector("#rp-persona-form")?.classList.remove("is-hidden");
  document.querySelector("#rp-conversation")?.classList.add("is-hidden");
  document.querySelectorAll(".rp-session-item.is-active").forEach((element) => element.classList.remove("is-active"));
}

function rpMessageHtml(message) {
  const mine = message.role !== "assistant";
  return `<div class="rp-message ${mine ? "rp-me" : "rp-ai"}"><span class="rp-message-role">${mine ? "Вы" : "ИИ-партнёр"}</span><div class="rp-message-text">${richTextToHtml(message.content)}</div></div>`;
}

function rpRenderMessages(messages = []) {
  const box = document.querySelector("#rp-messages");
  if (!box) return;
  box.innerHTML = messages.map(rpMessageHtml).join("");
  box.scrollTop = box.scrollHeight;
}

function rpOpenConversation(session, messages) {
  rpCurrentSessionId = session.id;
  document.querySelector("#rp-persona-form")?.classList.add("is-hidden");
  document.querySelector("#rp-conversation")?.classList.remove("is-hidden");
  const title = document.querySelector("#rp-conversation-title");
  if (title) title.textContent = session.title || "Сессия";
  rpRenderMessages(messages || []);
  document.querySelectorAll("[data-rp-open]").forEach((element) => element.classList.toggle("is-active", element.dataset.rpOpen === session.id));
}

async function openRpSession(id) {
  if (!id) return;
  try {
    const data = await apiFetch(`/ai/rp/sessions/${encodeURIComponent(id)}`);
    rpOpenConversation(data.session, data.messages);
  } catch (error) {
    showToast(apiFailure("Не удалось открыть сессию", error));
  }
}

document.querySelector("#rp-new-session")?.addEventListener("click", rpShowForm);
document.querySelector("#rp-back")?.addEventListener("click", rpShowForm);

document.querySelector("#rp-session-list")?.addEventListener("click", async (event) => {
  const del = event.target.closest("[data-rp-delete]");
  if (del) {
    event.stopPropagation();
    if (!window.confirm("Удалить сессию и всю историю?")) return;
    try {
      await apiFetch(`/ai/rp/sessions/${encodeURIComponent(del.dataset.rpDelete)}`, { method: "DELETE" });
      if (rpCurrentSessionId === del.dataset.rpDelete) rpShowForm();
      await loadRpSessions();
    } catch (error) {
      showToast(apiFailure("Не удалось удалить сессию", error));
    }
    return;
  }
  const open = event.target.closest("[data-rp-open]");
  if (open) openRpSession(open.dataset.rpOpen);
});

document.querySelector("#rp-persona-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!aiEnabled()) return;
  const status = document.querySelector("#rp-persona-status");
  const startButton = document.querySelector("#rp-start");
  const value = (id) => (document.querySelector(id)?.value || "").trim() || undefined;
  const payload = {
    title: (document.querySelector("#rp-title")?.value || "").trim(),
    fandom: value("#rp-fandom"),
    character: value("#rp-character"),
    userRole: value("#rp-userrole"),
    style: value("#rp-style"),
    tempo: value("#rp-tempo"),
    setting: value("#rp-setting"),
    boundaries: value("#rp-boundaries"),
    ageRating: document.querySelector("#rp-agerating")?.value || "TEEN"
  };
  if (payload.title.length < 2) {
    showToast("Укажите название сессии");
    return;
  }
  if (startButton) startButton.disabled = true;
  if (status) status.textContent = "ИИ создаёт сцену…";
  try {
    const data = await apiFetch("/ai/rp/sessions", { method: "POST", body: JSON.stringify(payload) });
    if (status) status.textContent = "";
    document.querySelector("#rp-persona-form")?.reset();
    await loadRpSessions();
    rpOpenConversation(data.session, data.messages);
  } catch (error) {
    if (status) status.textContent = "";
    showToast(apiFailure("Не удалось создать сессию", error));
  } finally {
    if (startButton) startButton.disabled = false;
  }
});

document.querySelector("#rp-message-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!rpCurrentSessionId) return;
  const input = document.querySelector("#rp-message-input");
  const sendButton = document.querySelector("#rp-send");
  const status = document.querySelector("#rp-message-status");
  const box = document.querySelector("#rp-messages");
  const content = (input?.value || "").trim();
  if (!content) return;
  if (box) {
    box.insertAdjacentHTML("beforeend", rpMessageHtml({ role: "user", content }));
    box.scrollTop = box.scrollHeight;
  }
  if (input) input.value = "";
  if (sendButton) sendButton.disabled = true;
  if (status) status.textContent = "ИИ-партнёр печатает…";
  try {
    const reply = await apiFetch(`/ai/rp/sessions/${encodeURIComponent(rpCurrentSessionId)}/message`, { method: "POST", body: JSON.stringify({ content }) });
    if (box) {
      box.insertAdjacentHTML("beforeend", rpMessageHtml(reply));
      box.scrollTop = box.scrollHeight;
    }
    if (status) status.textContent = "ИИ-партнёр отвечает в образе. Это не реальный человек.";
  } catch (error) {
    if (status) status.textContent = "";
    showToast(apiFailure("Не удалось отправить ход", error));
  } finally {
    if (sendButton) sendButton.disabled = false;
  }
});

document.querySelector("#listing-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken) {
    openAuthForCurrentView("Войдите, чтобы создать или редактировать заявку", "new-listing");
    return;
  }
  updateListingFormState();
  const titleValue = document.querySelector("#listing-title-input").value.trim();
  const bodyValue = document.querySelector("#listing-body-input").value.trim();
  const bodyPlainLength = richPlainLength(bodyValue);
  if (titleValue.length < 6 || bodyPlainLength < 20 || titleValue.length > 140 || bodyPlainLength > 4000 || !richWithinStoredLimit(bodyValue)) {
    showToast("Проверьте длину заголовка и описания заявки");
    return;
  }
  const payload = {
    type: document.querySelector("#listing-type").value,
    title: titleValue,
    body: bodyValue,
    ageRating: document.querySelector("#listing-rating").value,
    status: document.querySelector("#listing-status").value,
    tagSlugs: selectedListingTagSlugs,
    genreSlugs: selectedListingGenreSlugs,
    fandomSlugs: selectedListingFandomSlugs,
    characterSlugs: selectedListingCharacterSlugs
  };
  try {
    const { status, ...createPayload } = payload;
    const created = editingListingId
      ? await apiFetch(`/listings/${editingListingId}`, { method: "PATCH", body: JSON.stringify(createPayload) })
      : await apiFetch("/listings", { method: "POST", body: JSON.stringify(createPayload) });
    const finalListing = payload.status === "PUBLISHED"
      ? await apiFetch(`/listings/${created.id}/publish`, { method: "POST" })
      : created;
    const normalized = normalizeListing(finalListing);
    const existingIndex = listings.findIndex((listing) => String(listing.id) === String(normalized.id));
    if (existingIndex >= 0) listings[existingIndex] = normalized;
    else listings.unshift(normalized);
    renderListings();
    if (!editingListingId) trackEvent("listing_created");
    showToast(editingListingId ? "Заявка обновлена" : payload.status === "PUBLISHED" ? "Заявка отправлена на модерацию" : "Заявка создана в API как черновик");
    clearListingDraft();
    resetListingEditor({ restoreDraft: false });
    await loadMe();
    setView("me");
  } catch (error) {
    showToast(apiFailure(editingListingId ? "Не удалось обновить заявку через API" : "Не удалось создать заявку через API", error));
  }
});

document.querySelector("#listing-response-message")?.addEventListener("input", updateListingResponseState);

document.querySelector("#listing-response-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedListing) {
    showToast("Сначала откройте заявку из ленты");
    setView("feed");
    return;
  }
  if (!selectedListing.open) {
    showToast("Заявка закрыта для новых откликов");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы отправить отклик, войдите в аккаунт", "listing");
    return;
  }
  if (isUserBlocked(selectedListing.authorId)) {
    showToast("Автор заблокирован. Разблокируйте его в личном кабинете, чтобы отправить отклик.");
    updateListingResponseAccessState();
    updateListingResponseState();
    updateListingBlockedState();
    return;
  }
  const input = document.querySelector("#listing-response-message");
  const message = input.value.trim();
  const messagePlainLength = richPlainLength(message);
  updateListingResponseState();
  if (messagePlainLength < 10 || messagePlainLength > 4000 || !richWithinStoredLimit(message)) {
    showToast("Отклик должен быть от 10 до 4000 символов");
    return;
  }
  try {
    await apiFetch(`/listings/${selectedListing.id}/respond`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
    selectedListing.responses += 1;
    const item = listings.find((listing) => String(listing.id) === String(selectedListing.id));
    if (item) item.responses = selectedListing.responses;
    renderListingDetail(selectedListing);
    renderListings();
    loadInbox();
    input.value = "";
    syncRichEditorFromTextarea("listing-response-message");
    updateListingResponseState();
    trackEvent("response_sent");
    showToast("Отклик отправлен автору");
  } catch (error) {
    showToast(apiFailure("Не удалось отправить отклик через API", error));
  }
});

document.querySelector("#fill-response-template")?.addEventListener("click", () => {
  if (!requireAuthForAction("Войдите, чтобы написать отклик")) return;
  if (isUserBlocked(selectedListing?.authorId)) {
    showToast("Автор заблокирован. Шаблон отклика недоступен до разблокировки.");
    updateListingBlockedState();
    return;
  }
  const input = document.querySelector("#listing-response-message");
  if (!input || input.disabled) return;
  const title = selectedListing?.title || "ваша заявка";
  input.value = [
    `Здравствуйте! Меня заинтересовала заявка «${title}».`,
    "Мне близки заявленные жанры и формат, комфортный темп - 2-3 содержательных ответа в неделю.",
    "Готов(а) обсудить границы, ожидания по сценам и удобный способ связи перед стартом."
  ].join("\n\n");
  syncRichEditorFromTextarea("listing-response-message");
  focusRichEditor("listing-response-message");
  updateListingResponseState();
});

document.querySelector("#report-listing")?.addEventListener("click", () => {
  if (!selectedListing) return;
  openPrefilledReport({
    entityType: "LISTING",
    entityId: selectedListing.id,
    comment: `Жалоба на заявку "${selectedListing.title}"`,
    authView: "listing"
  });
});

document.querySelector("#open-author-profile")?.addEventListener("click", () => {
  openProfile(selectedListing?.authorUsername);
});

document.querySelector("#listing-related-tag")?.addEventListener("click", (event) => {
  if (shouldUseNativeNavigation(event, event.currentTarget)) return;
  event.preventDefault();
  applyRelatedListingFilter("tag");
});

document.querySelector("#listing-related-world")?.addEventListener("click", (event) => {
  if (shouldUseNativeNavigation(event, event.currentTarget)) return;
  event.preventDefault();
  applyRelatedListingFilter("world");
});

document.querySelector("#listing-related-list")?.addEventListener("click", (event) => {
  const card = event.target.closest("[data-open-related-listing]");
  if (!card) return;
  if (shouldUseNativeNavigation(event, card)) return;
  event.preventDefault();
  openListing(card.dataset.openRelatedListing);
});

document.querySelector("#listing-related-list")?.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const card = event.target.closest("[data-open-related-listing]");
  if (!card) return;
  event.preventDefault();
  openListing(card.dataset.openRelatedListing);
});

document.querySelector("#copy-listing-link")?.addEventListener("click", () => {
  if (!selectedListing?.id) {
    showToast("Сначала откройте заявку");
    return;
  }
  copyToClipboard(`${location.origin}${listingHref(selectedListing)}`, "Ссылка на заявку скопирована");
});

document.querySelector("#copy-profile-link")?.addEventListener("click", () => {
  const username = currentProfileUsername || selectedListing?.authorUsername;
  if (!username) {
    showToast("Публичный username профиля не найден");
    return;
  }
  copyToClipboard(`${location.origin}/profile/${encodeURIComponent(username)}`, "Ссылка на профиль скопирована");
});

document.querySelector("#message-profile-author")?.addEventListener("click", async () => {
  if (!currentPublicProfile?.user?.id) {
    showToast("Для диалога нужны данные профиля из API");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы написать автору, войдите в аккаунт", "profile");
    return;
  }
  if (currentPublicProfile.user.id === authSession.user?.id) {
    showToast("Это ваш профиль");
    return;
  }
  if (isUserBlocked(currentPublicProfile.user.id)) {
    showToast("Автор заблокирован. Разблокируйте его в личном кабинете, чтобы написать.");
    updatePublicProfileBlockedState();
    return;
  }
  try {
    const conversation = await apiFetch("/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ participantId: currentPublicProfile.user.id })
    });
    await loadInbox();
    setView("inbox", { url: inboxUrl(conversation.id, "dialogs") });
    await openPrivateConversation(conversation.id);
    showToast("Диалог открыт");
  } catch (error) {
    showToast(apiFailure("Не удалось открыть диалог", error));
  }
});

document.querySelector("#block-author")?.addEventListener("click", async () => {
  if (!selectedListing?.authorId) {
    showToast("Для блокировки нужны данные автора из API");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы заблокировать автора, войдите в аккаунт", "listing");
    return;
  }
  if (selectedListing.authorId === authSession.user?.id) {
    showToast("Себя блокировать не нужно");
    return;
  }
  if (isUserBlocked(selectedListing.authorId)) {
    updateListingBlockedState();
    showToast("Автор уже находится в блок-листе");
    return;
  }
  const button = document.querySelector("#block-author");
  if (button) button.disabled = true;
  try {
    await apiFetch("/me/blocks", {
      method: "POST",
      body: JSON.stringify({ userId: selectedListing.authorId })
    });
    rememberBlockedUser(blockEntryFromListing(selectedListing));
    updateListingResponseAccessState();
    updateListingResponseState();
    updateListingBlockedState();
    showToast("Автор заблокирован. Его заявки скрыты из ленты.");
  } catch (error) {
    showToast(apiFailure("Не удалось заблокировать автора", error));
    updateListingBlockedState();
  }
});

document.querySelector("#block-profile-author")?.addEventListener("click", async () => {
  if (!currentPublicProfile?.user?.id) {
    showToast("Для блокировки нужны данные профиля из API");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы заблокировать автора, войдите в аккаунт", "profile");
    return;
  }
  if (currentPublicProfile.user.id === authSession.user?.id) {
    showToast("Себя блокировать не нужно");
    return;
  }
  if (isUserBlocked(currentPublicProfile.user.id)) {
    updatePublicProfileBlockedState();
    showToast("Автор уже находится в блок-листе");
    return;
  }
  const button = document.querySelector("#block-profile-author");
  if (button) button.disabled = true;
  try {
    await apiFetch("/me/blocks", {
      method: "POST",
      body: JSON.stringify({ userId: currentPublicProfile.user.id })
    });
    rememberBlockedUser(blockEntryFromProfile(currentPublicProfile));
    updatePublicProfileBlockedState();
    showToast("Автор заблокирован. Его заявки скрыты из ленты.");
    await loadMe();
  } catch (error) {
    showToast(apiFailure("Не удалось заблокировать автора", error));
    updatePublicProfileBlockedState();
  }
});

document.querySelector("#report-profile-author")?.addEventListener("click", () => {
  if (!currentPublicProfile?.user?.id) {
    showToast("Для жалобы нужны данные профиля из API");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы отправить жалобу, войдите в аккаунт", "profile");
    return;
  }
  if (currentPublicProfile.user.id === authSession.user?.id) {
    showToast("На свой профиль жалоба не нужна");
    return;
  }
  openPrefilledReport({
    entityType: "PROFILE",
    entityId: currentPublicProfile.user.id,
    comment: `Жалоба на профиль ${currentPublicProfile.username || currentPublicProfile.displayName || currentPublicProfile.user.id}`,
    authView: "profile"
  });
});

document.querySelector("#like-listing")?.addEventListener("click", async (event) => {
  if (!selectedListing) return;
  if (!requireAuthForAction("Чтобы поставить лайк заявке, войдите в аккаунт")) return;
  if (listingIsFromBlockedAuthor(selectedListing)) {
    showToast("Заявка принадлежит заблокированному автору.");
    updateListingBlockedState();
    return;
  }
  if (pendingListingLikes.has(selectedListing.id)) return;
  pendingListingLikes.add(selectedListing.id);
  event.currentTarget.disabled = true;
  try {
    const result = await apiFetch(`/listings/${selectedListing.id}/like`, { method: "POST" });
    const likes = typeof result.likes === "number" ? result.likes : Math.max(0, (selectedListing.likes || 0) + (result.liked ? 1 : -1));
    syncListingLikeState(selectedListing.id, likes, Boolean(result.liked));
    showToast(result.liked ? "Заявка добавлена в понравившиеся" : "Лайк снят");
  } catch (error) {
    showToast(apiFailure("Не удалось изменить лайк", error));
  } finally {
    pendingListingLikes.delete(selectedListing.id);
    event.currentTarget.disabled = false;
  }
  event.currentTarget.textContent = `${selectedListing.likedByMe ? "♥" : "♡"} ${selectedListing.likes}`;
  event.currentTarget.classList.toggle("is-active", Boolean(selectedListing.likedByMe));
  renderListings();
});

document.querySelector("#private-refresh")?.addEventListener("click", () => {
  if (activePrivateConversationId) openPrivateConversation(activePrivateConversationId);
});

document.querySelector("#load-older-private")?.addEventListener("click", loadOlderPrivateMessages);

document.querySelector("#copy-private-link")?.addEventListener("click", () => {
  if (!activePrivateConversationId) {
    showToast("Сначала откройте диалог");
    return;
  }
  copyToClipboard(`${location.origin}${inboxUrl(activePrivateConversationId, "dialogs")}`, "Ссылка на диалог скопирована");
});

document.querySelector("#inbox-refresh")?.addEventListener("click", loadInbox);

document.querySelector("#private-search")?.addEventListener("input", () => {
  renderPrivateMessages(activePrivateMessages, { updateCache: false });
});

document.querySelector("#clear-private-search")?.addEventListener("click", () => {
  document.querySelector("#private-search").value = "";
  renderPrivateMessages(activePrivateMessages, { updateCache: false });
});

document.querySelector("#private-message-input")?.addEventListener("input", updatePrivateComposerState);

document.querySelector("#private-message-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken) {
    openAuthForCurrentView("Войдите, чтобы отправлять личные сообщения", "inbox");
    return;
  }
  if (!activePrivateConversationId) {
    showToast("Сначала откройте диалог");
    return;
  }
  const input = document.querySelector("#private-message-input");
  const text = input.value.trim();
  if (!stripRichText(text) || !richWithinStoredLimit(text)) return;
  const submit = document.querySelector("#private-submit");
  if (submit) submit.disabled = true;
  try {
    await apiFetch(`/conversations/${activePrivateConversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    input.value = "";
    syncRichEditorFromTextarea("private-message-input");
    updatePrivateComposerState();
    await openPrivateConversation(activePrivateConversationId);
    await loadInbox();
  } catch (error) {
    updatePrivateComposerState();
    showToast(apiFailure("Не удалось отправить личное сообщение", error));
  }
});

document.querySelector("#private-messages")?.addEventListener("click", async (event) => {
  const clearSearchButton = event.target.closest("[data-clear-private-search]");
  const deleteButton = event.target.closest("[data-delete-private-message]");
  const reportButton = event.target.closest("[data-report-private-message]");
  if (clearSearchButton) {
    const search = document.querySelector("#private-search");
    if (search) search.value = "";
    renderPrivateMessages(activePrivateMessages, { updateCache: false });
    return;
  }
  if (deleteButton) {
    if (!activePrivateConversationId) return;
    deleteButton.disabled = true;
    try {
      await apiFetch(`/conversations/${activePrivateConversationId}/messages/${deleteButton.dataset.deletePrivateMessage}`, { method: "DELETE" });
      await openPrivateConversation(activePrivateConversationId);
      await loadInbox();
      showToast("Сообщение удалено");
    } catch (error) {
      deleteButton.disabled = false;
      showToast(apiFailure("Не удалось удалить сообщение", error));
    }
    return;
  }
  if (!reportButton) return;
  const reportedMessage = activePrivateMessages.find((message) => String(message.id) === String(reportButton.dataset.reportPrivateMessage));
  if (reportedMessage?.sender?.id === authSession.user?.id) {
    showToast("На свое сообщение жалобу отправить нельзя");
    return;
  }
  openPrefilledReport({
    entityType: "PRIVATE_MESSAGE",
    entityId: reportButton.dataset.reportPrivateMessage,
    comment: "Жалоба на личное сообщение",
    authView: "inbox"
  });
});

document.querySelector("#admin-queue")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-action]");
  if (!button) return;
  const id = button.dataset.adminId;
  const action = button.dataset.adminAction;
  const configs = {
    "resolve-report": {
      path: `/admin/reports/${id}`,
      body: { status: "RESOLVED", resolutionComment: "Закрыто из web-админки Cofind 2" },
      success: "Жалоба закрыта"
    },
    "reject-report": {
      path: `/admin/reports/${id}`,
      body: { status: "REJECTED", resolutionComment: "Отклонено из web-админки Cofind 2" },
      success: "Жалоба отклонена"
    },
    "approve-suggestion": {
      path: `/admin/suggestions/${id}`,
      body: { status: "APPROVED", moderatorComment: "Одобрено из web-админки Cofind 2" },
      success: "Предложение одобрено"
    },
    "reject-suggestion": {
      path: `/admin/suggestions/${id}`,
      body: { status: "REJECTED", moderatorComment: "Отклонено из web-админки Cofind 2" },
      success: "Предложение отклонено"
    },
    "approve-listing": {
      path: `/admin/listings/${id}/moderate`,
      body: { status: "PUBLISHED", moderationStatus: "APPROVED" },
      success: "Заявка одобрена"
    },
    "hide-listing": {
      path: `/admin/listings/${id}/moderate`,
      body: { status: "HIDDEN", moderationStatus: "HIDDEN" },
      success: "Заявка скрыта"
    },
    "restore-listing": {
      path: `/admin/listings/${id}/moderate`,
      body: { status: "DRAFT", moderationStatus: "PENDING" },
      success: "Заявка восстановлена в черновики"
    }
  };
  const config = configs[action];
  if (!config) return;
  button.disabled = true;
  try {
    await apiFetch(config.path, { method: "PATCH", body: JSON.stringify(config.body) });
    showToast(config.success);
    await loadAdminDashboard();
    if (action.includes("listing")) scheduleFeedRefresh();
  } catch (error) {
    showToast(apiFailure("Не удалось выполнить действие модерации", error));
    button.disabled = false;
  }
});

document.querySelector("#admin-tags-refresh")?.addEventListener("click", loadAdminTags);
document.querySelector("#admin-genres-refresh")?.addEventListener("click", loadAdminGenres);
document.querySelector("#admin-fandoms-refresh")?.addEventListener("click", loadAdminFandoms);
document.querySelector("#admin-characters-refresh")?.addEventListener("click", loadAdminCharacters);
document.querySelector("#admin-users-refresh")?.addEventListener("click", loadAdminUsers);
document.querySelector("#admin-plans-refresh")?.addEventListener("click", loadAdminPlans);
document.querySelector("#admin-ads-refresh")?.addEventListener("click", loadAdminAds);
document.querySelector("#admin-finance-refresh")?.addEventListener("click", loadAdminFinance);
document.querySelector("#admin-seo-refresh")?.addEventListener("click", loadAdminSeoPages);
document.querySelector("#admin-settings-refresh")?.addEventListener("click", loadAdminSettings);
document.querySelector("#admin-finance-search")?.addEventListener("input", () => renderAdminFinance(adminFinanceCache));
document.querySelector("#admin-finance-kind")?.addEventListener("change", () => renderAdminFinance(adminFinanceCache));
document.querySelector("#admin-finance-status")?.addEventListener("change", () => renderAdminFinance(adminFinanceCache));
document.querySelector("#admin-audit-search")?.addEventListener("input", () => renderAuditLog(adminAuditCache));
document.querySelector("#admin-audit-entity")?.addEventListener("change", () => renderAuditLog(adminAuditCache));
document.querySelector("#admin-plans-search")?.addEventListener("input", () => renderAdminPlans(adminPlansCache));
document.querySelector("#admin-plans-status-filter")?.addEventListener("change", () => renderAdminPlans(adminPlansCache));
document.querySelector("#admin-ads-search")?.addEventListener("input", () => renderAdminAds(adminAdsCache));
document.querySelector("#admin-ads-position-filter")?.addEventListener("change", () => renderAdminAds(adminAdsCache));
document.querySelector("#admin-ads-status-filter")?.addEventListener("change", () => renderAdminAds(adminAdsCache));
document.querySelector("#admin-seo-search")?.addEventListener("input", () => renderAdminSeoPages(adminSeoCache));
document.querySelector("#admin-seo-index-filter")?.addEventListener("change", () => renderAdminSeoPages(adminSeoCache));
[
  ["tags", "#admin-tags-search", "#admin-tags-status-filter", renderAdminTags],
  ["genres", "#admin-genres-search", "#admin-genres-status-filter", renderAdminGenres],
  ["fandoms", "#admin-fandoms-search", "#admin-fandoms-status-filter", renderAdminFandoms],
  ["characters", "#admin-characters-search", "#admin-characters-status-filter", renderAdminCharacters]
].forEach(([kind, searchSelector, statusSelector, render]) => {
  document.querySelector(searchSelector)?.addEventListener("input", () => render(adminCatalogCache[kind]));
  document.querySelector(statusSelector)?.addEventListener("change", () => render(adminCatalogCache[kind]));
});

document.querySelector("#admin-reindex")?.addEventListener("click", async () => {
  if (!authSession.accessToken || !["OWNER", "ADMIN"].includes(authSession.user?.role)) {
    openAuthForCurrentView("Reindex доступен OWNER/ADMIN", "admin");
    return;
  }
  const status = document.querySelector("#admin-reindex-status");
  if (status) status.textContent = "Индекс обновляется...";
  try {
    const result = await apiFetch("/search/reindex", { method: "POST" });
    if (status) status.textContent = `Индексировано заявок: ${result.indexed}`;
    showToast("Поисковый индекс обновлен");
  } catch (error) {
    if (status) status.textContent = "Не удалось обновить индекс. Проверьте Meilisearch.";
    showToast(apiFailure("Не удалось обновить индекс", error));
  }
});

document.querySelector("#admin-settings-save")?.addEventListener("click", async () => {
  if (!authSession.accessToken || !["OWNER", "ADMIN"].includes(authSession.user?.role)) {
    openAuthForCurrentView("Настройки функций доступны OWNER/ADMIN", "admin");
    return;
  }
  const enabled = Boolean(document.querySelector("#admin-monetization-enabled")?.checked);
  const ai = Boolean(document.querySelector("#admin-ai-enabled")?.checked);
  try {
    const settings = await apiFetch("/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ monetizationEnabled: enabled, aiEnabled: ai })
    });
    featureFlags = { ...featureFlags, ...settings };
    applyFeatureFlags();
    renderAdminSettings(settings);
    renderAdminMetrics({ ...(await apiFetch("/admin/dashboard")) });
    await hydrateFromApi();
    showToast("Настройки функций сохранены");
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить настройки функций", error));
  }
});

document.querySelector("#admin-users")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-admin-user-action]");
  if (!button) return;
  const userId = button.dataset.userId;
  const action = button.dataset.adminUserAction;
  const config = {
    "temp-ban": {
      path: `/admin/users/${userId}/ban`,
      body: {
        type: "TEMP_BAN",
        reason: "Temporary moderation action from web admin",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      },
      success: "Пользователь временно забанен"
    },
    unban: {
      path: `/admin/users/${userId}/unban`,
      body: null,
      success: "Пользователь разбанен"
    },
    restore: {
      path: `/admin/users/${userId}/unban`,
      body: null,
      success: "Пользователь восстановлен"
    },
    "make-mod": {
      path: `/admin/users/${userId}/role`,
      body: { role: "MODERATOR" },
      success: "Роль изменена на MODERATOR"
    },
    "make-user": {
      path: `/admin/users/${userId}/role`,
      body: { role: "USER" },
      success: "Роль изменена на USER"
    }
  }[action];
  if (!config) return;
  try {
    await apiFetch(config.path, {
      method: "PATCH",
      ...(config.body ? { body: JSON.stringify(config.body) } : {})
    });
    showToast(config.success);
    await Promise.all([loadAdminUsers(), loadAdminDashboard()]);
  } catch (error) {
    showToast(apiFailure("Не удалось выполнить действие с пользователем", error));
  }
});

document.querySelector("#admin-tags-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-admin-tag]");
  if (!button) return;
  try {
    const tags = await apiFetch("/admin/tags");
    const tag = tags.find((item) => item.slug === button.dataset.editAdminTag);
    if (!tag) return;
    document.querySelector("#admin-tag-slug").value = tag.slug;
    document.querySelector("#admin-tag-name").value = tag.name;
    document.querySelector("#admin-tag-status").value = tag.status || "APPROVED";
    document.querySelector("#admin-tag-description").value = tag.description || "";
  } catch {
    showToast("Не удалось загрузить тег");
  }
});

document.querySelector("#admin-tag-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken || !isStaff()) {
    openAuthForCurrentView("Для редактирования тегов нужен staff-аккаунт", "admin");
    return;
  }
  const slug = document.querySelector("#admin-tag-slug").value.trim().toLowerCase();
  const payload = {
    slug,
    name: document.querySelector("#admin-tag-name").value.trim(),
    description: document.querySelector("#admin-tag-description").value.trim() || undefined,
    status: document.querySelector("#admin-tag-status").value
  };
  try {
    await apiFetch(`/admin/tags/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    showToast("Тег сохранен");
    await Promise.all([loadAdminTags(), hydrateFromApi()]);
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить тег", error));
  }
});

document.querySelector("#admin-genres-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-admin-genre]");
  if (!button) return;
  try {
    const genres = await apiFetch("/admin/genres");
    const genre = genres.find((item) => item.slug === button.dataset.editAdminGenre);
    if (!genre) return;
    document.querySelector("#admin-genre-slug").value = genre.slug;
    document.querySelector("#admin-genre-name").value = genre.name;
    document.querySelector("#admin-genre-status").value = genre.status || "APPROVED";
    document.querySelector("#admin-genre-description").value = genre.description || "";
  } catch {
    showToast("Не удалось загрузить жанр");
  }
});

document.querySelector("#admin-genre-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken || !isStaff()) {
    openAuthForCurrentView("Для редактирования жанров нужен staff-аккаунт", "admin");
    return;
  }
  const slug = document.querySelector("#admin-genre-slug").value.trim().toLowerCase();
  const payload = {
    slug,
    name: document.querySelector("#admin-genre-name").value.trim(),
    description: document.querySelector("#admin-genre-description").value.trim() || undefined,
    status: document.querySelector("#admin-genre-status").value
  };
  try {
    await apiFetch(`/admin/genres/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    showToast("Жанр сохранен");
    await Promise.all([loadAdminGenres(), hydrateFromApi()]);
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить жанр", error));
  }
});

document.querySelector("#admin-fandoms-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-admin-fandom]");
  if (!button) return;
  try {
    const fandoms = await apiFetch("/admin/fandoms");
    const fandom = fandoms.find((item) => item.slug === button.dataset.editAdminFandom);
    if (!fandom) return;
    document.querySelector("#admin-fandom-slug").value = fandom.slug;
    document.querySelector("#admin-fandom-name").value = fandom.name;
    document.querySelector("#admin-fandom-status").value = fandom.status || "APPROVED";
    document.querySelector("#admin-fandom-description").value = fandom.description || "";
  } catch {
    showToast("Не удалось загрузить фандом");
  }
});

document.querySelector("#admin-fandom-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken || !isStaff()) {
    openAuthForCurrentView("Для редактирования фандомов нужен staff-аккаунт", "admin");
    return;
  }
  const slug = document.querySelector("#admin-fandom-slug").value.trim().toLowerCase();
  const payload = {
    slug,
    name: document.querySelector("#admin-fandom-name").value.trim(),
    description: document.querySelector("#admin-fandom-description").value.trim() || undefined,
    status: document.querySelector("#admin-fandom-status").value
  };
  try {
    await apiFetch(`/admin/fandoms/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    showToast("Фандом сохранен");
    await Promise.all([loadAdminFandoms(), hydrateFromApi()]);
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить фандом", error));
  }
});

document.querySelector("#admin-characters-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-admin-character]");
  if (!button) return;
  try {
    const characters = await apiFetch("/admin/characters");
    const character = characters.find((item) => item.slug === button.dataset.editAdminCharacter);
    if (!character) return;
    document.querySelector("#admin-character-slug").value = character.slug;
    document.querySelector("#admin-character-name").value = character.name;
    document.querySelector("#admin-character-fandom-id").value = character.fandomId || "";
    document.querySelector("#admin-character-status").value = character.status || "APPROVED";
    document.querySelector("#admin-character-description").value = character.description || "";
  } catch {
    showToast("Не удалось загрузить персонажа");
  }
});

document.querySelector("#admin-character-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken || !isStaff()) {
    openAuthForCurrentView("Для редактирования персонажей нужен staff-аккаунт", "admin");
    return;
  }
  const slug = document.querySelector("#admin-character-slug").value.trim().toLowerCase();
  const payload = {
    slug,
    name: document.querySelector("#admin-character-name").value.trim(),
    description: document.querySelector("#admin-character-description").value.trim() || undefined,
    status: document.querySelector("#admin-character-status").value,
    fandomId: document.querySelector("#admin-character-fandom-id").value.trim() || undefined
  };
  try {
    await apiFetch(`/admin/characters/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    showToast("Персонаж сохранен");
    await Promise.all([loadAdminCharacters(), hydrateFromApi()]);
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить персонажа", error));
  }
});

document.querySelector("#admin-plans-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-admin-plan]");
  if (!button) return;
  try {
    const plans = await apiFetch("/admin/subscription-plans");
    const plan = plans.find((item) => item.code === button.dataset.editAdminPlan);
    if (!plan) return;
    document.querySelector("#admin-plan-code").value = plan.code;
    document.querySelector("#admin-plan-name").value = plan.name;
    document.querySelector("#admin-plan-price").value = plan.priceCents;
    document.querySelector("#admin-plan-days").value = plan.durationDays;
    document.querySelector("#admin-plan-description").value = plan.description;
    document.querySelector("#admin-plan-active").checked = plan.isActive;
  } catch {
    showToast("Не удалось загрузить тариф");
  }
});

document.querySelector("#admin-plan-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken || !["OWNER", "ADMIN"].includes(authSession.user?.role)) {
    openAuthForCurrentView("Для тарифов нужен OWNER или ADMIN", "admin");
    return;
  }
  const code = document.querySelector("#admin-plan-code").value.trim();
  const payload = {
    code,
    name: document.querySelector("#admin-plan-name").value.trim(),
    description: document.querySelector("#admin-plan-description").value.trim(),
    priceCents: Number(document.querySelector("#admin-plan-price").value),
    currency: "RUB",
    durationDays: Number(document.querySelector("#admin-plan-days").value),
    isActive: document.querySelector("#admin-plan-active").checked
  };
  try {
    await apiFetch(`/admin/subscription-plans/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    document.querySelector("#admin-plan-active").checked = true;
    showToast("Тариф сохранен");
    await Promise.all([loadAdminPlans(), hydrateFromApi()]);
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить тариф", error));
  }
});

document.querySelector("#admin-ads-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-admin-ad]");
  if (!button) return;
  try {
    const ads = await apiFetch("/admin/ads");
    const ad = ads.find((item) => item.id === button.dataset.editAdminAd);
    if (!ad) return;
    document.querySelector("#admin-ad-id").value = ad.id;
    document.querySelector("#admin-ad-name").value = ad.name;
    document.querySelector("#admin-ad-position").value = ad.position;
    document.querySelector("#admin-ad-status").value = ad.status;
    document.querySelector("#admin-ad-click-url").value = ad.clickUrl || "";
    document.querySelector("#admin-ad-image-url").value = ad.imageUrl || "";
    document.querySelector("#admin-ad-impression-limit").value = ad.impressionLimit ?? "";
    document.querySelector("#admin-ad-starts-at").value = toDatetimeLocal(ad.startsAt);
    document.querySelector("#admin-ad-ends-at").value = toDatetimeLocal(ad.endsAt);
    document.querySelector("#admin-ad-hide-premium").checked = Boolean(ad.target?.hideForPremium);
  } catch {
    showToast("Не удалось загрузить placement");
  }
});

document.querySelector("#admin-ad-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken || !isStaff()) {
    openAuthForCurrentView("Для рекламы нужен staff-аккаунт", "admin");
    return;
  }
  const id = document.querySelector("#admin-ad-id").value || "new";
  const payload = {
    name: document.querySelector("#admin-ad-name").value.trim(),
    position: document.querySelector("#admin-ad-position").value,
    status: document.querySelector("#admin-ad-status").value,
    clickUrl: document.querySelector("#admin-ad-click-url").value.trim() || null,
    imageUrl: document.querySelector("#admin-ad-image-url").value.trim() || null,
    impressionLimit: document.querySelector("#admin-ad-impression-limit").value === ""
      ? null
      : Number(document.querySelector("#admin-ad-impression-limit").value),
    startsAt: fromDatetimeLocal(document.querySelector("#admin-ad-starts-at").value),
    endsAt: fromDatetimeLocal(document.querySelector("#admin-ad-ends-at").value),
    hideForPremium: document.querySelector("#admin-ad-hide-premium").checked
  };
  try {
    await apiFetch(`/admin/ads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    document.querySelector("#admin-ad-id").value = "new";
    showToast("Placement сохранен");
    await Promise.all([loadAdminAds(), hydrateFromApi()]);
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить placement", error));
  }
});

document.querySelector("#admin-seo-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-edit-admin-seo]");
  if (!button) return;
  try {
    const pages = await apiFetch("/admin/seo-pages");
    const page = pages.find((item) => item.path === button.dataset.editAdminSeo);
    if (!page) return;
    document.querySelector("#admin-seo-path").value = page.path;
    document.querySelector("#admin-seo-title").value = page.title;
    document.querySelector("#admin-seo-h1").value = page.h1;
    document.querySelector("#admin-seo-description").value = page.description;
    document.querySelector("#admin-seo-canonical").value = page.canonical || "";
    document.querySelector("#admin-seo-og-title").value = page.ogTitle || "";
    document.querySelector("#admin-seo-og-description").value = page.ogDescription || "";
    document.querySelector("#admin-seo-og-image").value = page.ogImage || "";
    document.querySelector("#admin-seo-text").value = page.seoText || "";
    document.querySelector("#admin-seo-indexable").checked = page.indexable !== false;
  } catch {
    showToast("Не удалось загрузить SEO-страницу");
  }
});

document.querySelector("#admin-seo-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken || !["OWNER", "ADMIN"].includes(authSession.user?.role)) {
    openAuthForCurrentView("Для SEO нужен OWNER или ADMIN", "admin");
    return;
  }
  const rawPath = document.querySelector("#admin-seo-path").value.trim() || "/";
  const payload = {
    path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
    title: document.querySelector("#admin-seo-title").value.trim(),
    description: document.querySelector("#admin-seo-description").value.trim(),
    h1: document.querySelector("#admin-seo-h1").value.trim(),
    canonical: document.querySelector("#admin-seo-canonical").value.trim() || undefined,
    ogTitle: document.querySelector("#admin-seo-og-title").value.trim() || undefined,
    ogDescription: document.querySelector("#admin-seo-og-description").value.trim() || undefined,
    ogImage: document.querySelector("#admin-seo-og-image").value.trim() || undefined,
    indexable: document.querySelector("#admin-seo-indexable").checked,
    seoText: document.querySelector("#admin-seo-text").value.trim() || undefined
  };
  try {
    await apiFetch("/admin/seo-pages", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    document.querySelector("#admin-seo-indexable").checked = true;
    showToast("SEO-страница сохранена");
    await loadAdminSeoPages();
    openCurrentRoute({ updateHistory: false });
  } catch (error) {
    showToast(apiFailure("Не удалось сохранить SEO-страницу", error));
  }
});

document.querySelector("#notification-list")?.addEventListener("click", async (event) => {
  const readButton = event.target.closest("[data-read-notification]");
  const linkButton = event.target.closest("[data-notification-link]");
  if (readButton) {
    try {
      await apiFetch(`/notifications/${readButton.dataset.readNotification}/read`, { method: "POST" });
      latestNotifications = latestNotifications.map((notification) =>
        notification.id === readButton.dataset.readNotification ? { ...notification, isRead: true } : notification
      );
      renderNotifications(latestNotifications);
      loadMe();
    } catch {
      showToast("Не удалось отметить уведомление");
    }
  }
  if (linkButton) {
    const path = linkButton.dataset.notificationLink;
    const notification = linkButton.closest("[data-notification-id]");
    if (notification?.classList.contains("is-unread")) {
      apiFetch(`/notifications/${notification.dataset.notificationId}/read`, { method: "POST" })
        .then(() => {
          latestNotifications = latestNotifications.map((item) =>
            item.id === notification.dataset.notificationId ? { ...item, isRead: true } : item
          );
          renderNotifications(latestNotifications);
          loadMe();
        })
        .catch(() => null);
    }
    if (!path || !openAppPath(path)) showToast("Ссылка уведомления пока не связана с экраном");
  }
});

document.querySelector("#notification-tabs")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-notification-filter]");
  if (!button) return;
  activeNotificationFilter = ["all", "unread", "read"].includes(button.dataset.notificationFilter)
    ? button.dataset.notificationFilter
    : "all";
  renderNotifications(latestNotifications);
});

document.querySelector("#read-all-notifications")?.addEventListener("click", async () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы отметить уведомления, войдите в аккаунт", "me");
    return;
  }
  try {
    await apiFetch("/notifications/read-all", { method: "POST" });
    latestNotifications = latestNotifications.map((notification) => ({ ...notification, isRead: true }));
    renderNotifications(latestNotifications);
    loadMe();
    showToast("Уведомления отмечены прочитанными");
  } catch {
    showToast("Не удалось прочитать уведомления");
  }
});

document.querySelector("#refresh-payments")?.addEventListener("click", () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы обновить платежи, войдите в аккаунт", "subscription");
    return;
  }
  loadPayments();
});
document.querySelector("#payment-search")?.addEventListener("input", () => renderPayments(paymentsCache));
document.querySelector("#payment-status-filter")?.addEventListener("change", () => renderPayments(paymentsCache));

document.querySelector("#cancel-subscription")?.addEventListener("click", async () => {
  if (!monetizationEnabled()) {
    showToast("Платные функции пока не запущены");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы управлять подпиской, войдите в аккаунт", "subscription");
    return;
  }
  try {
    await apiFetch("/me/subscription/cancel", { method: "POST" });
    showToast("Premium отключен");
    await loadMe();
    await loadPayments();
  } catch (error) {
    showToast(apiFailure("Не удалось отключить Premium", error));
  }
});

document.querySelector("#block-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-unblock-user]");
  if (!button) return;
  try {
    const unblockedUserId = button.dataset.unblockUser;
    await apiFetch(`/me/blocks/${unblockedUserId}`, { method: "DELETE" });
    blocksCache = blocksCache.filter((block) => String(blockedUserId(block)) !== String(unblockedUserId));
    renderBlocks(blocksCache);
    showToast("Пользователь разблокирован");
    await loadBlocks({ force: true });
    loadMe();
  } catch {
    showToast("Не удалось разблокировать пользователя");
  }
});

document.querySelector("#block-list-search")?.addEventListener("input", () => renderBlocks(blocksCache));

const presets = {
  lavender: { accent: "#7a5cff", text: "#24263a", bg: "#f6f8fb", bodyClass: "" },
  writer: { accent: "#9d8cff", text: "#f5f6fb", bg: "#171821", bodyClass: "theme-writer" },
  paper: { accent: "#2f7d63", text: "#27322d", bg: "#f7fbf6", bodyClass: "" },
  neon: { accent: "#00a6a6", text: "#f3fbff", bg: "#16171f", bodyClass: "theme-writer" },
  romance: { accent: "#d45d79", text: "#302934", bg: "#fff7fb", bodyClass: "" },
  forest: { accent: "#2f7d63", text: "#1f332b", bg: "#f2faf5", bodyClass: "" },
  minimal: { accent: "#596275", text: "#22252d", bg: "#f5f7fa", bodyClass: "" }
};

function applyAppearance() {
  const presetName = document.querySelector("#theme-preset")?.value || "lavender";
  const preset = presets[presetName];
  const accent = document.querySelector("#accent-color")?.value || preset.accent;
  const text = document.querySelector("#text-color")?.value || preset.text;
  const fontSize = document.querySelector("#font-size")?.value || 16;
  const radius = document.querySelector("#radius-size")?.value || 8;
  const compact = document.querySelector("#density")?.value === "compact";
  const decorations = document.querySelector("#decorations")?.checked;
  const preview = document.querySelector("#live-preview");

  document.body.classList.toggle("theme-writer", preset.bodyClass === "theme-writer");
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--text", text);
  document.documentElement.style.setProperty("--bg", preset.bg);
  document.documentElement.style.setProperty("--font-size", `${fontSize}px`);
  document.documentElement.style.setProperty("--radius", `${radius}px`);
  preview?.style.setProperty("--preview-text", text);
  preview?.style.setProperty("--preview-font", compact ? "14px" : `${fontSize}px`);
  preview?.style.setProperty("--preview-radius", `${radius}px`);
  document.body.style.backgroundImage = decorations ? "" : "none";
  applyBackgroundPreview();
}

function applyBackgroundPreview() {
  const preview = document.querySelector("#live-preview");
  const imageUrl = document.querySelector("#background-image-url")?.value.trim();
  const overlay = Math.min(100, Math.max(0, Number(document.querySelector("#background-overlay")?.value || 20))) / 100;
  const safeUrl = safeImageUrl(imageUrl).replace(/["\\]/g, "");
  if (!preview) return;
  preview.style.backgroundImage = safeUrl
    ? `linear-gradient(rgb(255 255 255 / ${overlay}), rgb(255 255 255 / ${overlay})), url("${safeUrl}")`
    : "";
  preview.style.backgroundSize = safeUrl ? "cover" : "";
  preview.style.backgroundPosition = safeUrl ? "center" : "";
}

function appearancePayload() {
  const presetName = document.querySelector("#theme-preset")?.value || "lavender";
  const preset = presets[presetName];
  return {
    theme: presetName,
    accentColor: document.querySelector("#accent-color")?.value || preset.accent,
    secondaryColor: preset.accent,
    textColor: document.querySelector("#text-color")?.value || preset.text,
    fontSize: String(document.querySelector("#font-size")?.value || 16),
    borderRadius: Number(document.querySelector("#radius-size")?.value || 8),
    density: document.querySelector("#density")?.value || "comfortable",
    showDecorations: Boolean(document.querySelector("#decorations")?.checked),
    cardStyle: "soft",
    contentWidth: "wide",
    animationLevel: "normal"
  };
}

function applyPreferencesToControls(preferences) {
  if (!preferences) return;
  applyingRemotePreferences = true;
  const theme = preferences.theme && presets[preferences.theme] ? preferences.theme : "lavender";
  document.querySelector("#theme-preset").value = theme;
  document.querySelector("#accent-color").value = preferences.accentColor || presets[theme].accent;
  document.querySelector("#text-color").value = preferences.textColor || presets[theme].text;
  document.querySelector("#font-size").value = String(parseInt(preferences.fontSize, 10) || 16);
  document.querySelector("#radius-size").value = String(preferences.borderRadius || 8);
  document.querySelector("#density").value = preferences.density || "comfortable";
  document.querySelector("#decorations").checked = preferences.showDecorations !== false;
  document.querySelector("#background-image-url").value = preferences.dashboardBackgroundImage || "";
  document.querySelector("#background-overlay").value = String(preferences.dashboardBackgroundOverlay ?? 20);
  document.querySelector("#background-blur").value = String(preferences.dashboardBackgroundBlur ?? 0);
  applyAppearance();
  applyingRemotePreferences = false;
}

async function loadPreferences() {
  if (!authSession.accessToken) return;
  try {
    applyPreferencesToControls(await apiFetch("/me/preferences"));
  } catch {
    // Preferences remain local when token/API is unavailable.
  }
}

function schedulePreferenceSave() {
  if (applyingRemotePreferences || !authSession.accessToken) return;
  window.clearTimeout(savePreferencesTimer);
  savePreferencesTimer = window.setTimeout(async () => {
    try {
      await apiFetch("/me/preferences", {
        method: "PATCH",
        body: JSON.stringify(appearancePayload())
      });
      showToast("Внешний вид сохранён");
    } catch {
      showToast("Не удалось сохранить внешний вид");
    }
  }, 700);
}

document.querySelector("#theme-preset")?.addEventListener("change", (event) => {
  const preset = presets[event.target.value];
  document.querySelector("#accent-color").value = preset.accent;
  document.querySelector("#text-color").value = preset.text;
  applyAppearance();
  schedulePreferenceSave();
});

["#accent-color", "#text-color", "#font-size", "#radius-size", "#density", "#decorations"].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("input", () => {
    applyAppearance();
    schedulePreferenceSave();
  });
  document.querySelector(selector)?.addEventListener("change", () => {
    applyAppearance();
    schedulePreferenceSave();
  });
});

["#background-image-url", "#background-overlay", "#background-blur"].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("input", applyBackgroundPreview);
  document.querySelector(selector)?.addEventListener("change", applyBackgroundPreview);
});

document.querySelector("#reset-theme")?.addEventListener("click", () => {
  document.querySelector("#theme-preset").value = "lavender";
  document.querySelector("#accent-color").value = presets.lavender.accent;
  document.querySelector("#text-color").value = presets.lavender.text;
  document.querySelector("#font-size").value = "16";
  document.querySelector("#radius-size").value = "8";
  document.querySelector("#density").value = "comfortable";
  document.querySelector("#decorations").checked = true;
  applyAppearance();
  schedulePreferenceSave();
});

document.querySelector("#save-background")?.addEventListener("click", async () => {
  if (!authSession.accessToken) {
    openAuthForCurrentView("Чтобы сохранить фон, войдите в аккаунт", "appearance");
    return;
  }
  const imageUrl = document.querySelector("#background-image-url").value.trim();
  if (!safeImageUrl(imageUrl)) {
    showToast("Укажите URL изображения");
    return;
  }
  try {
    await apiFetch("/me/background", {
      method: "POST",
      body: JSON.stringify({
        imageUrl,
        overlay: Number(document.querySelector("#background-overlay").value || 20),
        blur: Number(document.querySelector("#background-blur").value || 0),
        position: "center"
      })
    });
    showToast("Фон сохранен");
    loadPreferences();
  } catch {
    showToast("Не удалось сохранить фон");
  }
});

document.querySelector("#clear-background")?.addEventListener("click", async () => {
  document.querySelector("#background-image-url").value = "";
  document.querySelector("#background-image-file").value = "";
  document.querySelector("#background-overlay").value = "20";
  document.querySelector("#background-blur").value = "0";
  applyAppearance();
  if (!authSession.accessToken) {
    showToast("Фон очищен локально");
    return;
  }
  try {
    await apiFetch("/me/background", { method: "DELETE" });
    showToast("Фон убран");
    loadPreferences();
  } catch (error) {
    showToast(apiFailure("Не удалось убрать фон", error));
  }
});

document.querySelector("#background-image-file")?.addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (!authSession.accessToken) {
    event.currentTarget.value = "";
    openAuthForCurrentView("Чтобы загрузить фон, войдите в аккаунт", "appearance");
    return;
  }
  const validationError = validateImageFile(file, "background");
  if (validationError) {
    showToast(validationError);
    event.currentTarget.value = "";
    return;
  }
  try {
    const dataUrl = await prepareImageDataUrl(file, "background");
    document.querySelector("#background-image-url").value = dataUrl;
    applyBackgroundPreview();
    if (apiOnline) {
      try {
        const uploaded = await uploadImageDataUrl(dataUrl, "background");
        document.querySelector("#background-image-url").value = uploaded.url;
        applyBackgroundPreview();
        showToast("Фон загружен в хранилище");
      } catch (error) {
        showToast(apiFailure("Не удалось загрузить фон", error));
      }
    }
  } catch (error) {
    showToast(apiFailure("Не удалось прочитать фон", error));
    event.currentTarget.value = "";
  }
});

applyAppearance();

function updateChatComposerState() {
  const input = document.querySelector("#chat-input");
  const counter = document.querySelector("#chat-counter");
  const submit = document.querySelector("#chat-submit");
  const note = document.querySelector("#chat-composer-note");
  const canvasButtons = [
    document.querySelector("#open-canvas"),
    document.querySelector("#open-canvas-bottom")
  ].filter(Boolean);
  const room = chatRooms.find((item) => item.slug === activeChatRoom) || chatRooms[0];
  const loggedIn = Boolean(authSession.accessToken);
  const unavailable = chatAvailability === "unavailable";
  const canWrite = loggedIn && !unavailable;
  if (input) {
    input.disabled = !canWrite;
    input.placeholder = loggedIn
      ? unavailable
        ? `Чат временно недоступен${chatErrorCode ? ` (${chatErrorCode})` : ""}`
        : "Напишите сообщение в общий чат"
      : "Войдите, чтобы написать сообщение в общий чат";
  }
  canvasButtons.forEach((button) => {
    button.disabled = !canWrite;
  });
  if (!canWrite && drawingData) {
    drawingData = null;
    setDrawingPreview(null);
  }
  updateRichEditorDisabled("chat-input");
  const value = input?.value || "";
  const textLength = richPlainLength(value);
  const storedOk = richWithinStoredLimit(value);
  const hasContent = canWrite && storedOk && Boolean(stripRichText(value) || drawingData);
  if (counter) {
    counter.textContent = `${textLength} / 4000`;
    counter.classList.toggle("is-warning", textLength > 3600 || !storedOk);
  }
  if (submit) submit.disabled = !hasContent;
  if (note) {
    note.textContent = !loggedIn
      ? "Войдите, чтобы писать в общий чат. Читать сообщения можно без регистрации, если это разрешено правилами."
      : unavailable
        ? chatDiagnostic().text
        : chatRealtimeState === "offline"
          ? chatDiagnostic().text
          : !storedOk
          ? "Форматирования слишком много: сократите текст или очистите часть оформления."
          : `Сообщение будет отправлено в ${room.label}.`;
  }
}

function chatRoomMarker(room = activeChatRoom) {
  return room && room !== "general" ? `[#${room}] ` : "";
}

function chatMessagesPath({ cursor, room = activeChatRoom } = {}) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (room && room !== "general") params.set("room", room);
  const query = params.toString();
  return `/chat/messages${query ? `?${query}` : ""}`;
}

function wireChatRooms() {
  const rooms = document.querySelector("#chat-rooms");
  const note = document.querySelector("#chat-room-note");
  if (!rooms) return;
  if (!chatRooms.some((room) => room.slug === activeChatRoom)) activeChatRoom = "general";
  rooms.querySelectorAll("[data-chat-room]").forEach((button) => {
    const selected = button.dataset.chatRoom === activeChatRoom;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  const room = chatRooms.find((item) => item.slug === activeChatRoom) || chatRooms[0];
  if (note) note.textContent = `Комната: ${room.label}. ${room.hint}`;
  updateChatComposerState();
}

function updateChatHistoryControls() {
  const button = document.querySelector("#load-older-chat");
  const status = document.querySelector("#chat-history-status");
  const search = document.querySelector("#chat-search")?.value.trim() || "";
  const unavailable = chatAvailability === "unavailable";
  if (button) {
    button.disabled = unavailable || chatLoadingOlder || !chatHasMore || !messages.length || Boolean(search);
    button.textContent = chatLoadingOlder ? "Загружаю историю..." : "Загрузить старые сообщения";
  }
  if (status) {
    status.textContent = unavailable
      ? chatDiagnostic().text
      : search
        ? "Поиск идет по уже загруженным сообщениям."
        : chatLoadingOlder
          ? "Загружаю более ранние сообщения."
          : messages.length === 0
            ? "Пока сообщений нет. Начните обсуждение первым."
            : chatHasMore
              ? "Можно дозагрузить более раннюю историю."
              : "Вся доступная история чата загружена.";
  }
}

function renderMessages({ stickToBottom = true } = {}) {
  const box = document.querySelector("#messages");
  if (!box) return;
  const search = document.querySelector("#chat-search")?.value.trim().toLowerCase() || "";
  const searchStatus = document.querySelector("#chat-search-status");
  const roomMessages = activeChatRoom === "general"
    ? messages
    : messages.filter((message) => message.room === activeChatRoom);
  const visibleMessages = search
    ? roomMessages.filter((message) => [message.author, message.authorUsername, message.staff ? "команда" : "", stripRichText(message.text || ""), stripRichText(message.quote || ""), message.room]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search))
    : roomMessages;
  if (searchStatus) {
    const room = chatRooms.find((item) => item.slug === activeChatRoom) || chatRooms[0];
    searchStatus.textContent = chatAvailability === "unavailable"
      ? chatDiagnostic().text
      : search
        ? `Найдено ${visibleMessages.length} ${plural(visibleMessages.length, ["сообщение", "сообщения", "сообщений"])} по запросу.`
        : activeChatRoom === "general"
          ? "Показываем последние сообщения."
          : `Показываем ${visibleMessages.length} ${plural(visibleMessages.length, ["сообщение", "сообщения", "сообщений"])} в ${room.label}.`;
  }
  if (chatAvailability === "unavailable") {
    const diag = chatDiagnostic();
    box.innerHTML = `<article class="message chat-state-message is-error"><h2>Чат временно недоступен.</h2><p>${escapeHtml(diag.text)}</p>${diag.code ? `<p class="chat-error-code">Код ошибки: <code>${escapeHtml(diag.code)}</code></p>` : ""}<p><button type="button" class="secondary-button" data-chat-retry>Повторить попытку</button></p></article>`;
    updateChatHistoryControls();
    return;
  }
  box.innerHTML = visibleMessages.length ? visibleMessages.map((message) => {
    const quickReactionEmojis = ["✨", "❤️", "👀"];
    const quickReactionButtons = quickReactionEmojis.map((emoji) => {
      const count = message.reactions?.[emoji] || 0;
      return `<button class="${message.reactedByMe?.[emoji] ? "is-active" : ""}" data-react="${escapeHtml(message.id)}" data-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)}${count ? ` ${escapeHtml(count)}` : ""}</button>`;
    }).join("");
    const reactions = Object.entries(message.reactions)
      .filter(([emoji, count]) => count > 0 && !quickReactionEmojis.includes(emoji))
      .map(([emoji, count]) => `<button class="${message.reactedByMe?.[emoji] ? "is-active" : ""}" data-react="${escapeHtml(message.id)}" data-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)} ${escapeHtml(count)}</button>`)
      .join("");
    const quoteText = stripRichText(message.quote || "");
    const quote = quoteText ? `<div class="quoted">В ответ на: ${escapeHtml(quoteText)}</div>` : "";
    const drawing = message.drawing ? `<img class="drawing-thumb" src="${escapeHtml(message.drawing)}" alt="Рисунок из мини-холста" loading="lazy" decoding="async" />` : "";
    const own = message.senderId && message.senderId === authSession.user?.id;
    const authorName = message.authorUsername
      ? `<a href="/profile/${encodeURIComponent(message.authorUsername)}" data-open-profile="${escapeHtml(message.authorUsername)}">${escapeHtml(message.author)}</a>`
      : escapeHtml(message.author);
    return `
      <article class="message" data-message-id="${escapeHtml(message.id)}">
        <div class="message-head">
          ${avatarMarkup(message.author, message.avatarUrl || "", "small")}
          <strong>${authorName}${message.staff ? ` <span class="pill soft">команда</span>` : ""}</strong>
          <span>${escapeHtml(message.time)}</span>
        </div>
        ${quote}
        <div class="message-text">${richTextToHtml(message.text)}</div>
        ${drawing}
        <div class="message-actions">
          <button data-quote="${escapeHtml(message.id)}">Цитировать</button>
          <button class="${message.likedByMe ? "is-active" : ""}" data-like-message="${escapeHtml(message.id)}">${message.likedByMe ? "♥" : "♡"} ${escapeHtml(message.likes)}</button>
          ${quickReactionButtons}
          ${own ? "" : `<button type="button" class="danger-action" data-report-message="${escapeHtml(message.id)}" aria-label="Пожаловаться на сообщение">Пожаловаться</button>`}
          ${own ? `<button data-delete-message="${escapeHtml(message.id)}">Удалить</button>` : ""}
          ${reactions}
        </div>
      </article>
    `;
  }).join("") : `<article class="message chat-state-message"><h2>${escapeHtml(search ? "Сообщений по запросу не найдено." : "Пока сообщений нет.")}</h2><p>${escapeHtml(search ? "Попробуйте изменить запрос или сбросить поиск." : "Начните обсуждение первым.")}</p><div class="message-actions">${search ? `<button type="button" data-clear-chat-search>Сбросить поиск</button>` : activeChatRoom === "general" ? "" : `<button type="button" data-chat-room-empty="general">Открыть # общий</button>`}</div></article>`;
  if (chatRealtimeState === "offline") {
    box.insertAdjacentHTML("afterbegin", `<article class="message chat-state-message is-warning"><p>${escapeHtml(chatDiagnostic().text)}</p></article>`);
  }
  if (stickToBottom) keepMessagesAtBottom();
  updateChatHistoryControls();
  renderHomeChat();
}

function keepMessagesAtBottom() {
  const box = document.querySelector("#messages");
  if (!box) return;
  const scroll = () => {
    box.scrollTop = box.scrollHeight;
  };
  scroll();
  requestAnimationFrame(scroll);
  window.setTimeout(scroll, 80);
  window.setTimeout(scroll, 250);
  box.querySelectorAll("img.drawing-thumb").forEach((image) => {
    if (image.complete) return;
    image.addEventListener("load", scroll, { once: true });
    image.addEventListener("error", scroll, { once: true });
  });
}

async function loadOlderChatMessages() {
  if (chatLoadingOlder || !chatHasMore || !messages.length) return;
  const box = document.querySelector("#messages");
  const previousHeight = box?.scrollHeight || 0;
  const roomMessages = activeChatRoom === "general" ? messages : messages.filter((message) => message.room === activeChatRoom);
  const cursor = roomMessages[0]?.id;
  if (!cursor) return;
  chatLoadingOlder = true;
  updateChatHistoryControls();
  try {
    const remote = await apiFetch(chatMessagesPath({ cursor }));
    const batch = Array.isArray(remote) ? remote : [];
    const knownIds = new Set(messages.map((message) => String(message.id)));
    const olderMessages = batch
      .slice()
      .reverse()
      .map(normalizeMessage)
      .filter((message) => !knownIds.has(String(message.id)));
    chatHasMore = batch.length >= chatPageSize;
    if (olderMessages.length) messages = [...olderMessages, ...messages];
    renderMessages({ stickToBottom: false });
    if (box) box.scrollTop = Math.max(0, box.scrollHeight - previousHeight);
    if (!olderMessages.length && !chatHasMore) showToast("Более ранних сообщений нет");
  } catch (error) {
    showToast(apiFailure("Не удалось загрузить старые сообщения", error));
  } finally {
    chatLoadingOlder = false;
    updateChatHistoryControls();
  }
}

document.querySelector("#messages")?.addEventListener("click", async (event) => {
  const retryButton = event.target.closest("[data-chat-retry]");
  if (retryButton) {
    event.preventDefault();
    chatAvailability = "loading";
    chatErrorCode = null;
    renderMessages({ stickToBottom: false });
    connectChatSocket();
    await hydrateFromApi();
    return;
  }
  const profileLink = event.target.closest("[data-open-profile]");
  const emptyRoomButton = event.target.closest("[data-chat-room-empty]");
  const clearSearchButton = event.target.closest("[data-clear-chat-search]");
  const quoteButton = event.target.closest("[data-quote]");
  const likeButton = event.target.closest("[data-like-message]");
  const reactButton = event.target.closest("[data-react]");
  const reportButton = event.target.closest("[data-report-message]");
  const deleteButton = event.target.closest("[data-delete-message]");

  if (emptyRoomButton) {
    activeChatRoom = emptyRoomButton.dataset.chatRoomEmpty || "general";
    localStorage.setItem(chatRoomKey, activeChatRoom);
    if (currentViewName() === "chat") {
      const targetUrl = chatUrl(activeChatRoom);
      const currentUrl = `${location.pathname}${location.search}${location.hash}`;
      if (currentUrl !== targetUrl) history.pushState({ view: "chat", room: activeChatRoom }, "", targetUrl);
      updateSeo("chat");
    }
    wireChatRooms();
    renderMessages();
    return;
  }

  if (clearSearchButton) {
    document.querySelector("#chat-search").value = "";
    renderMessages();
    return;
  }

  if (profileLink) {
    if (shouldUseNativeNavigation(event, profileLink)) return;
    event.preventDefault();
    openProfile(profileLink.dataset.openProfile);
    return;
  }

  if (quoteButton) {
    quotedMessage = messages.find((message) => String(message.id) === String(quoteButton.dataset.quote));
    document.querySelector("#quote-text").textContent = `Цитата: ${quotedMessage.text.slice(0, 92)}`;
    document.querySelector("#quote-box").classList.remove("is-hidden");
    document.querySelector("#chat-input").focus();
  }

  if (likeButton) {
    const message = messages.find((item) => String(item.id) === String(likeButton.dataset.likeMessage));
    if (!message || !requireAuthForAction("Чтобы поставить лайк сообщению, войдите в аккаунт")) return;
    if (pendingMessageLikes.has(message.id)) return;
    pendingMessageLikes.add(message.id);
    likeButton.disabled = true;
    try {
      const result = await apiFetch(`/chat/messages/${message.id}/like`, { method: "POST" });
      message.likes = typeof result.likes === "number" ? result.likes : Math.max(0, (message.likes || 0) + (result.liked ? 1 : -1));
      message.likedByMe = Boolean(result.liked);
    } catch (error) {
      showToast(apiFailure("Не удалось изменить лайк сообщения", error));
    } finally {
      pendingMessageLikes.delete(message.id);
      likeButton.disabled = false;
    }
    renderMessages();
  }

  if (reactButton) {
    const message = messages.find((item) => String(item.id) === String(reactButton.dataset.react));
    const emoji = reactButton.dataset.emoji;
    if (!message || !requireAuthForAction("Чтобы поставить реакцию, войдите в аккаунт")) return;
    const pendingKey = String(message.id);
    if (pendingMessageReactions.has(pendingKey)) return;
    pendingMessageReactions.add(pendingKey);
    reactButton.disabled = true;
    try {
      const result = await apiFetch(`/chat/messages/${message.id}/react`, { method: "POST", body: JSON.stringify({ emoji }) });
      message.reactions[emoji] = typeof result.count === "number" ? result.count : Math.max(0, (message.reactions[emoji] || 0) + (result.reacted ? 1 : -1));
      message.reactedByMe = { ...(message.reactedByMe || {}), [emoji]: Boolean(result.reacted) };
      if (!message.reactions[emoji]) delete message.reactions[emoji];
      for (const removed of result.removedReactions || []) {
        message.reactions[removed.emoji] = removed.count;
        message.reactedByMe[removed.emoji] = false;
        if (!message.reactions[removed.emoji]) delete message.reactions[removed.emoji];
      }
    } catch (error) {
      showToast(apiFailure("Не удалось изменить реакцию", error));
    } finally {
      pendingMessageReactions.delete(pendingKey);
      reactButton.disabled = false;
    }
    renderMessages();
  }

  if (reportButton) {
    const message = messages.find((item) => String(item.id) === String(reportButton.dataset.reportMessage));
    if (message?.senderId === authSession.user?.id) {
      showToast("На свое сообщение жалобу отправить нельзя");
      return;
    }
    openPrefilledReport({
      entityType: "GLOBAL_CHAT_MESSAGE",
      entityId: reportButton.dataset.reportMessage,
      comment: `Жалоба на сообщение общего чата${message?.author ? ` от ${message.author}` : ""}`,
      authView: "chat"
    });
  }

  if (deleteButton) {
    try {
      if (authSession.accessToken) {
        await apiFetch(`/chat/messages/${deleteButton.dataset.deleteMessage}`, { method: "DELETE" });
      }
      messages = messages.filter((message) => String(message.id) !== String(deleteButton.dataset.deleteMessage));
      renderMessages();
      showToast("Сообщение удалено");
    } catch {
      showToast("Не удалось удалить сообщение");
    }
  }
});

document.querySelector("#clear-quote")?.addEventListener("click", () => {
  quotedMessage = null;
  document.querySelector("#quote-box").classList.add("is-hidden");
});

document.querySelector("#chat-input")?.addEventListener("input", updateChatComposerState);
document.querySelector("#chat-search")?.addEventListener("input", renderMessages);
document.querySelector("#clear-chat-search")?.addEventListener("click", () => {
  document.querySelector("#chat-search").value = "";
  renderMessages();
});

document.querySelector("#load-older-chat")?.addEventListener("click", loadOlderChatMessages);

document.querySelector("#copy-chat-room-link")?.addEventListener("click", () => {
  const room = chatRooms.find((item) => item.slug === activeChatRoom) || chatRooms[0];
  copyToClipboard(`${location.origin}${chatUrl(activeChatRoom)}`, `Ссылка на ${room.label} скопирована`);
});

document.querySelector("#chat-rooms")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chat-room]");
  if (!button) return;
  activeChatRoom = button.dataset.chatRoom || "general";
  localStorage.setItem(chatRoomKey, activeChatRoom);
  if (currentViewName() === "chat") {
    const targetUrl = chatUrl(activeChatRoom);
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (currentUrl !== targetUrl) history.pushState({ view: "chat", room: activeChatRoom }, "", targetUrl);
    updateSeo("chat");
  }
  const search = document.querySelector("#chat-search");
  if (search) search.value = "";
  wireChatRooms();
  renderMessages();
});

document.querySelector("#chat-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authSession.accessToken) {
    openAuthForCurrentView("Войдите, чтобы писать в общий чат.", "chat");
    return;
  }
  if (chatAvailability === "unavailable") {
    showToast(chatDiagnostic().text);
    return;
  }
  const input = document.querySelector("#chat-input");
  const text = input.value.trim();
  if ((!stripRichText(text) && !drawingData) || !richWithinStoredLimit(text)) return;
  const outboundText = text || "Отправлен рисунок с мини-холста";
  let outboundDrawing = drawingData;
  if (authSession.accessToken && apiOnline && outboundDrawing?.startsWith("data:image/")) {
    try {
      const uploaded = await uploadImageDataUrl(outboundDrawing, "drawing");
      outboundDrawing = uploaded.url || outboundDrawing;
      showToast("Рисунок загружен в хранилище");
    } catch (error) {
      showToast(apiFailure("Не удалось загрузить рисунок, отправляю локальное превью", error));
    }
  }
  let sent = false;
  if (chatSocket?.readyState === WebSocket.OPEN && !outboundDrawing) {
    chatSocket.send(JSON.stringify({
      type: "chat.message",
      text: outboundText,
      room: activeChatRoom,
      quotedGlobalMessageId: quotedMessage?.id,
      drawingUrl: outboundDrawing || undefined
    }));
    sent = true;
  } else {
    try {
      const remote = await apiFetch("/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          text: outboundText,
          room: activeChatRoom,
          quotedGlobalMessageId: quotedMessage?.id,
          drawingUrl: outboundDrawing || undefined
        })
      });
      messages.push(normalizeMessage(remote));
      sent = true;
    } catch (error) {
      showToast("Не удалось отправить сообщение. Проверьте соединение и попробуйте снова.");
    }
  }
  if (!sent) return;
  input.value = "";
  syncRichEditorFromTextarea("chat-input");
  drawingData = null;
  setDrawingPreview(null);
  quotedMessage = null;
  document.querySelector("#quote-box").classList.add("is-hidden");
  updateChatComposerState();
  renderMessages();
});

initializeRichEditors();
openCurrentRoute({ updateHistory: false });
renderMessages();
updateChatComposerState();
updateAllRichPreviews();
wireChatRooms();
reconcileBootAuthState();
updateAuthUi();
bootstrapAuthFromCookie().catch(() => {});
setApiStatus(false, "Проверяем доступность сервиса");
setWsStatus(false);
hydrateFromApi();
loadBlocks();
loadMe();
loadPreferences();
loadMySuggestions();
loadMyReports();
loadPayments();
connectChatSocket();

document.querySelector("#plans-list")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-checkout-plan]");
  if (!button) return;
  if (!monetizationEnabled()) {
    showToast("Платные функции пока не запущены");
    return;
  }
  if (!authSession.accessToken) {
    openAuthForCurrentView("Для оформления подписки сначала войдите", "subscription");
    return;
  }
  try {
    const result = await apiFetch("/me/subscription/checkout", {
      method: "POST",
      body: JSON.stringify({ planCode: button.dataset.checkoutPlan })
    });
    await apiFetch("/payments/webhook", {
      method: "POST",
      body: JSON.stringify({
        paymentId: result.payment.id,
        status: "SUCCEEDED",
        providerPaymentId: `web-${Date.now()}`
      })
    });
    await loadMe();
    await loadPayments();
    showToast("Premium активирован");
  } catch (error) {
    showToast(apiFailure("Не удалось перейти к оплате", error));
  }
});

let dialog = null;
let canvas = null;
let context = null;
let brushColorInput = null;
let brushSizeInput = null;
let eraserButton = null;
let drawing = false;
let lastPoint = null;
let canvasMounted = false;

const CANVAS_DIALOG_HTML = `
      <form method="dialog" class="dialog-head">
        <strong>Мини-холст</strong>
        <button aria-label="Закрыть">×</button>
      </form>
      <div class="canvas-tools">
        <label>Цвет <input id="brush-color" type="color" value="#2f7d63" /></label>
        <label>Кисть <input id="brush-size" type="range" min="2" max="22" value="6" /></label>
        <button id="eraser" type="button">Ластик</button>
        <button id="clear-canvas" type="button">Очистить</button>
      </div>
      <canvas id="draw-canvas" width="400" height="300"></canvas>
      <div class="dialog-actions">
        <button class="secondary-button" id="send-drawing" type="button">Отправить рисунок</button>
      </div>`;

// The mini-canvas is built lazily on first use (only reachable from the chat
// view), so it is not mounted in the DOM of every page.
function ensureCanvas() {
  if (canvasMounted) return;
  canvasMounted = true;
  dialog = document.createElement("dialog");
  dialog.className = "canvas-dialog";
  dialog.id = "canvas-dialog";
  dialog.innerHTML = CANVAS_DIALOG_HTML;
  document.body.appendChild(dialog);
  canvas = dialog.querySelector("#draw-canvas");
  context = canvas?.getContext("2d");
  brushColorInput = dialog.querySelector("#brush-color");
  brushSizeInput = dialog.querySelector("#brush-size");
  eraserButton = dialog.querySelector("#eraser");

  dialog.addEventListener("close", () => {
    drawing = false;
    lastPoint = null;
  });
  canvas?.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    drawing = true;
    lastPoint = canvasPoint(event);
    drawCanvasDot(lastPoint);
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers can deny capture after native color/range controls; drawing still works.
    }
  });
  canvas?.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    event.preventDefault();
    drawTo(canvasPoint(event));
  });
  canvas?.addEventListener("pointerup", finishCanvasStroke);
  canvas?.addEventListener("pointerleave", finishCanvasStroke);
  canvas?.addEventListener("pointercancel", finishCanvasStroke);
  brushColorInput?.addEventListener("input", () => setEraserMode(false));
  brushSizeInput?.addEventListener("input", () => configureCanvasStroke());
  eraserButton?.addEventListener("click", () => setEraserMode(!eraserMode));
  dialog.querySelector("#clear-canvas")?.addEventListener("click", () => {
    context?.clearRect(0, 0, canvas.width, canvas.height);
  });
  dialog.querySelector("#send-drawing")?.addEventListener("click", async () => {
    if (!requireAuthForAction("Войдите, чтобы отправить рисунок в чат")) return;
    const dataUrl = await optimizeImageDataUrl(canvas.toDataURL("image/png"), "drawing");
    const validationError = validateImageDataUrl(dataUrl, "drawing");
    if (validationError) {
      showToast(validationError);
      return;
    }
    drawingData = dataUrl;
    setDrawingPreview(drawingData);
    dialog.close();
    showToast("Рисунок прикреплен к следующему сообщению");
    focusRichEditor("chat-input");
  });
}

function openCanvas() {
  if (!requireAuthForAction("Войдите, чтобы рисовать и отправлять в чат")) return;
  ensureCanvas();
  if (!dialog?.showModal) {
    showToast("Ваш браузер не поддерживает dialog, но холст готов в коде прототипа");
    return;
  }
  drawing = false;
  lastPoint = null;
  dialog.showModal();
}

document.querySelector("#open-canvas")?.addEventListener("click", openCanvas);
document.querySelector("#open-canvas-bottom")?.addEventListener("click", openCanvas);
window.addEventListener("pointerup", finishCanvasStroke);

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const point = event.touches?.[0] || event;
  return {
    x: ((point.clientX - rect.left) / rect.width) * canvas.width,
    y: ((point.clientY - rect.top) / rect.height) * canvas.height
  };
}

function currentBrushColor() {
  const value = String(brushColorInput?.value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#2f7d63";
}

function currentBrushSize() {
  const value = Number(brushSizeInput?.value || 6);
  return Math.min(22, Math.max(2, Number.isFinite(value) ? value : 6));
}

function setEraserMode(next) {
  eraserMode = Boolean(next);
  if (eraserButton) eraserButton.textContent = eraserMode ? "Кисть" : "Ластик";
}

function configureCanvasStroke() {
  if (!context) return;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = currentBrushSize();
  context.strokeStyle = eraserMode ? "#ffffff" : currentBrushColor();
  context.fillStyle = context.strokeStyle;
}

function drawCanvasDot(point) {
  if (!context) return;
  configureCanvasStroke();
  context.beginPath();
  context.arc(point.x, point.y, Math.max(1, currentBrushSize() / 2), 0, Math.PI * 2);
  context.fill();
}

function drawTo(point) {
  if (!context || !lastPoint) return;
  configureCanvasStroke();
  context.beginPath();
  context.moveTo(lastPoint.x, lastPoint.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  lastPoint = point;
}

function finishCanvasStroke(event) {
  drawing = false;
  lastPoint = null;
  if (event?.pointerId !== undefined && canvas?.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

document.querySelector("#remove-drawing")?.addEventListener("click", () => {
  drawingData = null;
  setDrawingPreview(null);
  showToast("Рисунок убран");
});

// --- E-mail verification banner + notification settings ---
let emailSettingsApplying = false;

function applyEmailNotificationSettings(me) {
  const verifyBlock = document.querySelector("#me-email-verify");
  if (verifyBlock) {
    verifyBlock.classList.toggle("is-hidden", me?.emailVerified !== false);
    const addr = document.querySelector("#me-email-address");
    if (addr) addr.textContent = me?.email || "";
  }
  const prefs = me?.preferences || {};
  emailSettingsApplying = true;
  const responseToggle = document.querySelector("#notify-email-response");
  const messageToggle = document.querySelector("#notify-email-message");
  if (responseToggle) responseToggle.checked = prefs.emailOnResponse !== false;
  if (messageToggle) messageToggle.checked = prefs.emailOnMessage !== false;
  emailSettingsApplying = false;
}

async function saveEmailNotificationSettings() {
  if (emailSettingsApplying || !authSession.accessToken) return;
  const body = {
    emailOnResponse: document.querySelector("#notify-email-response")?.checked !== false,
    emailOnMessage: document.querySelector("#notify-email-message")?.checked !== false
  };
  try {
    await apiFetch("/me/preferences", { method: "PATCH", body: JSON.stringify(body) });
    showToast("Настройки уведомлений сохранены");
  } catch {
    showToast("Не удалось сохранить настройки уведомлений");
  }
}

document.querySelector("#notify-email-response")?.addEventListener("change", saveEmailNotificationSettings);
document.querySelector("#notify-email-message")?.addEventListener("change", saveEmailNotificationSettings);
document.querySelector("#resend-verification")?.addEventListener("click", async () => {
  try {
    await apiFetch("/auth/resend-verification", { method: "POST" });
    showToast("Письмо отправлено повторно. Проверьте почту.");
  } catch {
    showToast("Не удалось отправить письмо. Попробуйте позже.");
  }
});

try {
  const verified = new URLSearchParams(location.search).get("verified");
  if (verified === "1") showToast("E-mail подтверждён");
  else if (verified === "0") showToast("Ссылка подтверждения устарела. Запросите новое письмо в личном кабинете.");
} catch {
  // no-op
}
