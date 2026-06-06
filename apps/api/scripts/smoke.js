const API_BASE = process.env.API_BASE || "http://localhost:4000/api/v1";
const EXPECTED_UPLOAD_BASE = (process.env.UPLOAD_BASE || process.env.PUBLIC_API_BASE || API_BASE).replace(/\/+$/, "");
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const TOO_LARGE_PNG = `data:image/png;base64,${"a".repeat(490_000)}`;
const RATE_LIMIT_RETRIES = Number(process.env.SMOKE_RATE_LIMIT_RETRIES || 4);
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET?.trim();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function paymentWebhookHeaders(headers = {}) {
  return PAYMENT_WEBHOOK_SECRET
    ? { ...headers, "x-cofind-webhook-secret": PAYMENT_WEBHOOK_SECRET }
    : headers;
}

function rateLimitDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return Math.min(60_000, 10_000 * attempt);
}

async function fetchJson(path, options = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (response.status !== 429 || attempt > RATE_LIMIT_RETRIES) {
      return { response, text, body };
    }
    await wait(rateLimitDelay(response, attempt));
  }
}

async function request(path, options = {}) {
  const { response, text, body } = await fetchJson(path, options);
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return body;
}

async function requestRaw(path, options = {}) {
  const { response, body } = await fetchJson(path, options);
  return { ok: response.ok, status: response.status, body };
}

async function main() {
  const healthResponse = await fetch(`${API_BASE}/health`);
  if (!healthResponse.ok || !healthResponse.headers.get("x-content-type-options") || !healthResponse.headers.get("x-frame-options")) {
    throw new Error("Expected API health to include baseline security headers");
  }
  const live = await request("/health/live");
  if (!live.ok) throw new Error("Expected liveness check to return ok=true");
  const ready = await request("/health/ready");
  if (!ready.ok || !ready.dependencies?.database?.ok || !ready.dependencies?.meilisearch?.ok) {
    throw new Error("Expected readiness check to confirm database and Meilisearch");
  }
  const badLogin = await requestRaw("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "missing@cofind.local", password: "wrong-password" })
  });
  if (badLogin.ok || badLogin.body?.ok !== false || !badLogin.body?.timestamp || !badLogin.body?.path) {
    throw new Error("Expected normalized error envelope for bad login");
  }
  const duplicateEmailRegister = await requestRaw("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: "MIRA@cofind.local",
      username: `smokedupe${Date.now()}`,
      displayName: "Smoke Duplicate Email",
      password: "password123"
    })
  });
  if (duplicateEmailRegister.ok || duplicateEmailRegister.status !== 409) {
    throw new Error("Expected case-insensitive duplicate email register to fail with 409");
  }
  const duplicateUsernameRegister = await requestRaw("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `smoke-username-${Date.now()}@cofind.local`,
      username: "MiraInk",
      displayName: "Smoke Duplicate Username",
      password: "password123"
    })
  });
  if (duplicateUsernameRegister.ok || duplicateUsernameRegister.status !== 409) {
    throw new Error("Expected case-insensitive duplicate username register to fail with 409");
  }
  await request("/listings");
  await request("/listings", { headers: { Authorization: "Bearer invalid-public-token" } });
  const pagedPublicListings = await request("/listings?page=1&pageSize=2");
  if (!pagedPublicListings.pagination || pagedPublicListings.pagination.pageSize !== 2 || !Array.isArray(pagedPublicListings.hits)) {
    throw new Error("Expected paginated public listings response when page is requested");
  }
  await request("/chat/messages", { headers: { Authorization: "Bearer invalid-public-token" } });
  await request("/search/listings?q=детектив");
  await request("/search/listings?q=детектив", { headers: { Authorization: "Bearer invalid-public-token" } });
  const pagedSearch = await request("/search/listings?page=1&pageSize=2");
  if (!pagedSearch.pagination || pagedSearch.pagination.page !== 1 || pagedSearch.pagination.pageSize !== 2 || !Array.isArray(pagedSearch.hits)) {
    throw new Error("Expected paginated search/listings response");
  }
  const popularSearch = await request("/search/listings?sort=popular&page=1&pageSize=2");
  if (!popularSearch.pagination || popularSearch.source !== "postgres" || !Array.isArray(popularSearch.hits)) {
    throw new Error("Expected sorted popular search/listings response from Postgres");
  }
  const unansweredSearch = await request("/search/listings?sort=unanswered&page=1&pageSize=2");
  if (!unansweredSearch.pagination || unansweredSearch.source !== "postgres" || !Array.isArray(unansweredSearch.hits)) {
    throw new Error("Expected sorted unanswered search/listings response from Postgres");
  }
  const genreSearch = await request(`/search/listings?genre=${encodeURIComponent("Фэнтези")}`);
  if (!(genreSearch.hits || genreSearch).some((listing) => listing.title.includes("детектив") || listing.title.includes("Urban fantasy"))) {
    throw new Error("Expected genre-filtered search results");
  }
  const genreSlugSearch = await request("/search/listings?genre=fantasy");
  if (!(genreSlugSearch.hits || genreSlugSearch).some((listing) => listing.title.includes("детектив") || listing.title.includes("Urban fantasy"))) {
    throw new Error("Expected slug genre-filtered search results");
  }
  const fandomSearch = await request(`/search/listings?fandom=${encodeURIComponent("Ориджиналы")}`);
  if (!(fandomSearch.hits || fandomSearch).some((listing) => listing.fandoms?.some((item) => item.fandom?.name === "Ориджиналы" || item === "Ориджиналы"))) {
    throw new Error("Expected fandom-filtered search results");
  }
  const uppercaseSlugSearch = await request("/search/listings?genre=FANTASY");
  if (!(uppercaseSlugSearch.hits || uppercaseSlugSearch).some((listing) => listing.genreSlugs?.includes?.("fantasy") || listing.genres?.some((item) => item.genre?.slug === "fantasy" || item === "Фэнтези"))) {
    throw new Error("Expected Meilisearch catalog filter terms to be case-insensitive for slugs");
  }
  const trimmedGenreSearch = await request(`/search/listings?genre=${encodeURIComponent(" Fantasy ")}`);
  if (!(trimmedGenreSearch.hits || trimmedGenreSearch).some((listing) => listing.genreSlugs?.includes?.("fantasy") || listing.genres?.some((item) => item.genre?.slug === "fantasy" || item === "Фэнтези"))) {
    throw new Error("Expected search filters to trim catalog query values");
  }
  const publicListingsBySlug = await request("/listings?genre=fantasy&fandom=originals&character=original-character");
  if (!publicListingsBySlug.some((listing) => listing.genres?.some((item) => item.genre?.slug === "fantasy"))) {
    throw new Error("Expected public listings endpoint to accept catalog slugs");
  }
  const publicListingsByTrimmedCharacter = await request(`/listings?character=${encodeURIComponent(" Original-Character ")}`);
  if (!publicListingsByTrimmedCharacter.some((listing) => listing.characters?.some((item) => item.character?.slug === "original-character"))) {
    throw new Error("Expected public listings endpoint to trim character filter");
  }
  await request("/tags");
  const miraProfile = await request("/profiles/miraink");
  if (!("lastSeenAt" in miraProfile.user)) {
    throw new Error("Expected public profile to expose lastSeenAt");
  }
  if (!miraProfile.listingsPagination || miraProfile.stats?.listings < (miraProfile.user?.listings?.length || 0)) {
    throw new Error("Expected public profile to expose total listing stats and pagination metadata");
  }
  const pagedMiraProfile = await request("/profiles/miraink?page=1&pageSize=2");
  if (pagedMiraProfile.listingsPagination?.pageSize !== 2 || !Array.isArray(pagedMiraProfile.user?.listings)) {
    throw new Error("Expected public profile listings to support page/pageSize");
  }
  const searchedMiraProfile = await request(`/profiles/miraink?page=1&pageSize=2&q=${encodeURIComponent("детектив")}&sort=popular`);
  if (searchedMiraProfile.listingsPagination?.sort !== "popular" || searchedMiraProfile.listingsPagination?.q !== "детектив") {
    throw new Error("Expected public profile listings to support q/sort query metadata");
  }
  const miraProfileListing = miraProfile.user?.listings?.[0];
  if (miraProfileListing && (!Array.isArray(miraProfileListing.genres) || !Array.isArray(miraProfileListing.fandoms))) {
    throw new Error("Expected public profile listings to include full catalog relations");
  }
  if (miraProfileListing && (typeof miraProfileListing.likes !== "number" || typeof miraProfileListing.responses !== "number")) {
    throw new Error("Expected public profile listings to include listing metrics");
  }
  const publicSettings = await request("/settings");
  if (publicSettings.monetizationEnabled !== false) {
    throw new Error("Expected monetization to be disabled by default for public launch");
  }
  const disabledPlans = await request("/subscription/plans");
  if (!Array.isArray(disabledPlans) || disabledPlans.length !== 0) {
    throw new Error("Expected public subscription plans to stay hidden while monetization is disabled");
  }
  const invalidAdPosition = await requestRaw("/ads/placements?position=NOT_A_POSITION");
  if (invalidAdPosition.ok || invalidAdPosition.status !== 400) {
    throw new Error("Expected invalid ad position to fail with 400");
  }

  const session = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "mira@cofind.local", password: "password123" })
  });
  if (!session.refreshToken) {
    throw new Error("Expected login to return refresh token");
  }
  const privacySuffix = Date.now();
  const privacyUsername = `smokeprivacy${privacySuffix}`;
  const privacyTarget = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `smoke-privacy-${privacySuffix}@cofind.local`,
      username: privacyUsername,
      displayName: "Smoke Privacy",
      password: "password123"
    })
  });
  const privacyProfile = await request("/me/profile", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${privacyTarget.accessToken}` },
    body: JSON.stringify({
      displayName: "Smoke Privacy",
      showLastSeen: false,
      allowProfileMessages: false,
      socialWebsite: "https://example.com/smoke-privacy",
      socialTelegram: "@smokeprivacy",
      socialDiscord: "smokeprivacy"
    })
  });
  if (privacyProfile.privacySettings?.showLastSeen !== false || privacyProfile.privacySettings?.allowProfileMessages !== false) {
    throw new Error("Expected profile privacy settings to be saved");
  }
  if (
    privacyProfile.socialLinks?.website !== "https://example.com/smoke-privacy" ||
    privacyProfile.socialLinks?.telegram !== "@smokeprivacy" ||
    privacyProfile.socialLinks?.discord !== "smokeprivacy"
  ) {
    throw new Error("Expected profile social links to be saved");
  }
  const privatePublicProfile = await request(`/profiles/${privacyUsername}`);
  if (privatePublicProfile.user?.lastSeenAt !== null || privatePublicProfile.user?.canMessage !== false) {
    throw new Error("Expected public profile to respect lastSeen and message privacy");
  }
  if (privatePublicProfile.socialLinks?.telegram !== "@smokeprivacy") {
    throw new Error("Expected public profile to expose social links");
  }
  if (!privatePublicProfile.stats || typeof privatePublicProfile.stats.likes !== "number" || typeof privatePublicProfile.stats.responses !== "number") {
    throw new Error("Expected public profile to expose listing stats");
  }
  const privateDirectConversation = await requestRaw("/conversations/direct", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ participantId: privacyTarget.user.id })
  });
  if (privateDirectConversation.ok || privateDirectConversation.status !== 403) {
    throw new Error("Expected direct conversation to respect profile message privacy");
  }
  const refreshedSession = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: session.refreshToken })
  });
  if (!refreshedSession.accessToken || !refreshedSession.refreshToken) {
    throw new Error("Expected auth refresh to return a new session");
  }
  const badRefresh = await requestRaw("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: "not-a-refresh-token" })
  });
  if (badRefresh.ok || badRefresh.status !== 401) {
    throw new Error("Expected invalid refresh token to fail with 401");
  }

  const resetEmail = `reset-${Date.now()}-${Math.floor(Math.random() * 10000)}@cofind.local`;
  const resetUser = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: resetEmail,
      username: `reset${Date.now()}${Math.floor(Math.random() * 10000)}`,
      displayName: "Smoke Reset User",
      password: "password123"
    })
  });
  if (!resetUser.accessToken) {
    throw new Error("Expected reset smoke user to register");
  }
  const missingReset = await request("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: `missing-${Date.now()}@cofind.local` })
  });
  if (!missingReset.ok || missingReset.resetToken) {
    throw new Error("Expected password reset request for unknown email to stay generic");
  }
  const resetRequest = await request("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: resetEmail.toUpperCase() })
  });
  if (!resetRequest.ok) {
    throw new Error("Expected password reset request to return a generic success response");
  }
  const invalidReset = await requestRaw("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token: "not-a-valid-reset-token", newPassword: "password456" })
  });
  if (invalidReset.ok || invalidReset.status !== 400) {
    throw new Error("Expected invalid password reset token to fail with 400");
  }
  let resetCurrentPassword = "password123";
  let resetSession = null;
  if (resetRequest.resetToken) {
    await request("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token: resetRequest.resetToken, newPassword: "password456" })
    });
    const oldResetLogin = await requestRaw("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: resetEmail, password: "password123" })
    });
    if (oldResetLogin.ok) {
      throw new Error("Expected old password to stop working after reset");
    }
    resetSession = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: resetEmail, password: "password456" })
    });
    resetCurrentPassword = "password456";
  } else {
    resetSession = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: resetEmail, password: "password123" })
    });
  }
  const badChangePassword = await requestRaw("/auth/change-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${resetSession.accessToken}` },
    body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "password789" })
  });
  if (badChangePassword.ok || badChangePassword.status !== 401) {
    throw new Error("Expected wrong current password change to fail with 401");
  }
  await request("/auth/change-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${resetSession.accessToken}` },
    body: JSON.stringify({ currentPassword: resetCurrentPassword, newPassword: "password789" })
  });
  await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: resetEmail, password: "password789" })
  });

  const deactivateSuffix = Date.now();
  const deactivateEmail = `smoke-deactivate-${deactivateSuffix}@cofind.local`;
  const deactivateUsername = `smokedeact${deactivateSuffix}`;
  const deactivateSession = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: deactivateEmail,
      username: deactivateUsername,
      displayName: "Smoke Deactivate",
      password: "password123"
    })
  });
  const badDeactivate = await requestRaw("/auth/deactivate", {
    method: "POST",
    headers: { Authorization: `Bearer ${deactivateSession.accessToken}` },
    body: JSON.stringify({ password: "wrong-password" })
  });
  if (badDeactivate.ok || badDeactivate.status !== 401) {
    throw new Error("Expected account deactivation with wrong password to fail with 401");
  }
  const deactivateDrawingUpload = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${deactivateSession.accessToken}` },
    body: JSON.stringify({ purpose: "drawing", dataUrl: TINY_PNG })
  });
  await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${deactivateSession.accessToken}` },
    body: JSON.stringify({ text: "Smoke deactivation drawing cleanup", drawingUrl: deactivateDrawingUpload.url })
  });
  const deactivated = await request("/auth/deactivate", {
    method: "POST",
    headers: { Authorization: `Bearer ${deactivateSession.accessToken}` },
    body: JSON.stringify({ password: "password123" })
  });
  if (deactivated.status !== "DELETED") {
    throw new Error("Expected deactivation to mark user as DELETED");
  }
  const deactivatedLogin = await requestRaw("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: deactivateEmail, password: "password123" })
  });
  if (deactivatedLogin.ok || deactivatedLogin.status !== 401) {
    throw new Error("Expected deactivated account login to fail with 401");
  }
  const deactivatedProfile = await requestRaw(`/profiles/${deactivateUsername}`);
  if (deactivatedProfile.ok || deactivatedProfile.status !== 404) {
    throw new Error("Expected deactivated public profile to be hidden");
  }
  const deactivatedDrawingFile = await fetch(deactivateDrawingUpload.url);
  if (deactivatedDrawingFile.ok) {
    throw new Error("Expected deactivation to delete own uploaded drawing files");
  }

  const meAfterLastSeen = await request("/auth/me", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!meAfterLastSeen.lastSeenAt) {
    throw new Error("Expected auth/me to include lastSeenAt after authenticated activity");
  }

  await request("/me/preferences", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });

  const uploadedAvatar = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "avatar", dataUrl: TINY_PNG })
  });
  if (!uploadedAvatar.url?.includes("/uploads/images/") || uploadedAvatar.size < 1) {
    throw new Error("Expected image upload to return a public uploads URL");
  }
  if (!uploadedAvatar.url.startsWith(`${EXPECTED_UPLOAD_BASE}/uploads/images/`)) {
    throw new Error("Expected image upload URL to use the public API base, not an internal or localhost fallback");
  }
  const uploadedAvatarResponse = await fetch(uploadedAvatar.url);
  if (!uploadedAvatarResponse.ok || !uploadedAvatarResponse.headers.get("content-type")?.includes("image/png")) {
    throw new Error("Expected uploaded image URL to return a PNG response");
  }
  const uploadedDrawing = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "drawing", dataUrl: TINY_PNG })
  });
  if (!uploadedDrawing.url?.includes("/uploads/images/") || uploadedDrawing.size < 1) {
    throw new Error("Expected drawing upload to return a public uploads URL");
  }
  const uploadedBackground = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "background", dataUrl: TINY_PNG })
  });
  const uploadedCover = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "cover", dataUrl: TINY_PNG })
  });
  if (!uploadedCover.url?.includes("/uploads/images/") || uploadedCover.size < 1) {
    throw new Error("Expected cover upload to return a public uploads URL");
  }
  for (const uploaded of [uploadedDrawing, uploadedBackground, uploadedCover]) {
    if (!uploaded.url?.startsWith(`${EXPECTED_UPLOAD_BASE}/uploads/images/`)) {
      throw new Error("Expected every uploaded image URL to use the configured public API base");
    }
  }
  const oversizedUpload = await requestRaw("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "drawing", dataUrl: TOO_LARGE_PNG })
  });
  if (oversizedUpload.ok || oversizedUpload.status !== 400) {
    throw new Error("Expected oversized image upload to fail with 400");
  }
  const invalidUploadPurpose = await requestRaw("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "banner", dataUrl: TINY_PNG })
  });
  if (invalidUploadPurpose.ok || invalidUploadPurpose.status !== 400) {
    throw new Error("Expected invalid image upload purpose to fail with 400");
  }
  const invalidProfileImageUrl = await requestRaw("/me/profile", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ avatarUrl: "javascript:alert(1)", coverImageUrl: "ftp://example.local/cover.png" })
  });
  if (invalidProfileImageUrl.ok || invalidProfileImageUrl.status !== 400) {
    throw new Error("Expected unsafe profile image URLs to fail with 400");
  }
  const invalidSocialUrl = await requestRaw("/me/profile", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ socialWebsite: "javascript:alert(1)", socialTelegram: "https://evil.example/mira" })
  });
  if (invalidSocialUrl.ok || invalidSocialUrl.status !== 400) {
    throw new Error("Expected unsafe profile social URLs to fail with 400");
  }
  const backgroundPreferences = await request("/me/background", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ imageUrl: uploadedBackground.url, overlay: 25, blur: 2, position: "center" })
  });
  if (backgroundPreferences.dashboardBackgroundImage !== uploadedBackground.url || backgroundPreferences.dashboardBackgroundOverlay !== 25) {
    throw new Error("Expected uploaded background URL to be saved in preferences");
  }
  const invalidBackgroundUrl = await requestRaw("/me/background", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ imageUrl: "ftp://example.local/background.png", overlay: 25, blur: 2, position: "center" })
  });
  if (invalidBackgroundUrl.ok || invalidBackgroundUrl.status !== 400) {
    throw new Error("Expected unsafe background image URL to fail with 400");
  }
  const replacementBackground = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "background", dataUrl: TINY_PNG })
  });
  await request("/me/background", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ imageUrl: replacementBackground.url, overlay: 25, blur: 2, position: "center" })
  });
  const oldBackgroundAfterReplace = await fetch(uploadedBackground.url);
  if (oldBackgroundAfterReplace.ok) {
    throw new Error("Expected replaced background upload file to be deleted");
  }
  const clearedBackground = await request("/me/background", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (clearedBackground.dashboardBackgroundImage !== null || clearedBackground.dashboardBackgroundType !== "plain") {
    throw new Error("Expected clearing background to remove image preferences");
  }
  const replacementBackgroundAfterClear = await fetch(replacementBackground.url);
  if (replacementBackgroundAfterClear.ok) {
    throw new Error("Expected cleared background upload file to be deleted");
  }

  const exportedBeforeProfile = await request("/me/export", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (exportedBeforeProfile.user?.email !== "mira@cofind.local" || !exportedBeforeProfile.exportedAt) {
    throw new Error("Expected data export to include current user and exportedAt");
  }
  if (JSON.stringify(exportedBeforeProfile).includes("passwordHash")) {
    throw new Error("Expected data export to omit password hashes");
  }

  const updatedProfile = await request("/me/profile", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      displayName: "MiraInk",
      bio: "Пишу камерные сюжеты, люблю атмосферу, сложные диалоги и бережный темп.",
      avatarUrl: uploadedAvatar.url,
      coverImageUrl: uploadedCover.url,
      writingStyle: "атмосферный",
      literacyLevel: "бережная редактура",
      preferredPostLength: "2-4 абзаца",
      activityLevel: "2-3 раза в неделю",
      communicationPreferences: "ЛС сайта, Discord после знакомства",
      favoriteGenres: [" Фэнтези ", "Драма", "Фэнтези"],
      favoriteFandoms: [" Ориджиналы "],
      favoriteCharacters: [" Original Character "]
    })
  });
  if (!updatedProfile.favoriteGenres?.includes("Фэнтези") || !updatedProfile.favoriteFandoms?.includes("Ориджиналы")) {
    throw new Error("Expected profile catalog preferences to be saved");
  }
  if (updatedProfile.avatarUrl !== uploadedAvatar.url) {
    throw new Error("Expected profile avatarUrl to be saved");
  }
  if (updatedProfile.coverImageUrl !== uploadedCover.url) {
    throw new Error("Expected profile coverImageUrl to be saved");
  }
  if (updatedProfile.preferredPostLength !== "2-4 абзаца" || updatedProfile.literacyLevel !== "бережная редактура") {
    throw new Error("Expected extended profile preferences to be saved");
  }
  if (updatedProfile.communicationPreferences !== "ЛС сайта, Discord после знакомства") {
    throw new Error("Expected profile communication preferences to be saved");
  }
  if (updatedProfile.favoriteGenres.filter((item) => item === "Фэнтези").length !== 1) {
    throw new Error("Expected profile catalog preferences to be deduplicated");
  }
  const replacementAvatar = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "avatar", dataUrl: TINY_PNG })
  });
  const replacementCover = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "cover", dataUrl: TINY_PNG })
  });
  const replacedProfileImages = await request("/me/profile", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ avatarUrl: replacementAvatar.url, coverImageUrl: replacementCover.url })
  });
  if (replacedProfileImages.avatarUrl !== replacementAvatar.url || replacedProfileImages.coverImageUrl !== replacementCover.url) {
    throw new Error("Expected replacement profile image URLs to be saved");
  }
  const oldAvatarAfterReplace = await fetch(uploadedAvatar.url);
  const oldCoverAfterReplace = await fetch(uploadedCover.url);
  if (oldAvatarAfterReplace.ok || oldCoverAfterReplace.ok) {
    throw new Error("Expected replaced profile upload files to be deleted");
  }
  const clearedProfileImages = await request("/me/profile", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ avatarUrl: "", coverImageUrl: "" })
  });
  if (clearedProfileImages.avatarUrl !== null || clearedProfileImages.coverImageUrl !== null) {
    throw new Error("Expected cleared profile image URLs to be stored as null");
  }
  const avatarAfterClear = await fetch(replacementAvatar.url);
  const coverAfterClear = await fetch(replacementCover.url);
  if (avatarAfterClear.ok || coverAfterClear.ok) {
    throw new Error("Expected cleared profile upload files to be deleted");
  }
  const emptyDisplayName = await requestRaw("/me/profile", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ displayName: " " })
  });
  if (emptyDisplayName.ok || emptyDisplayName.status !== 400) {
    throw new Error("Expected empty profile display name to fail with 400");
  }

  const suggestion = await request("/suggestions", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      type: "TAG",
      title: `smoke-tag-${Date.now()}`,
      description: "Smoke test suggestion"
    })
  });
  const duplicateSuggestion = await requestRaw("/suggestions", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      type: suggestion.type,
      title: suggestion.title,
      description: "Smoke test duplicate suggestion"
    })
  });
  if (duplicateSuggestion.ok || duplicateSuggestion.status !== 400) {
    throw new Error("Expected duplicate active suggestion to fail with 400");
  }
  const mySuggestions = await request("/suggestions/my", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!mySuggestions.some((item) => item.id === suggestion.id)) {
    throw new Error("Expected created suggestion in suggestions/my");
  }
  const pagedMySuggestions = await request("/suggestions/my?page=1&pageSize=2", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!pagedMySuggestions.pagination || pagedMySuggestions.pagination.pageSize !== 2 || !Array.isArray(pagedMySuggestions.hits)) {
    throw new Error("Expected paginated suggestions/my response when page is requested");
  }

  await request("/notifications/read-all", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  const pagedNotifications = await request("/notifications?page=1&pageSize=5", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!pagedNotifications.pagination || pagedNotifications.pagination.pageSize !== 5 || !Array.isArray(pagedNotifications.hits)) {
    throw new Error("Expected paginated notifications response when page is requested");
  }
  const missingNotificationRead = await requestRaw("/notifications/missing-notification/read", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (missingNotificationRead.ok || missingNotificationRead.status !== 404) {
    throw new Error("Expected reading missing notification to fail with 404");
  }
  const missingUnblock = await request(`/me/blocks/missing-user-id`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (missingUnblock.unblocked !== false) {
    throw new Error("Expected missing unblock to be idempotent false");
  }

  const globalMessage = await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: '<p onclick="alert(1)">Smoke test global chat message <script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.com/chat">safe</a></p>' })
  });
  if (globalMessage.room !== "general") {
    throw new Error("Expected global chat message without room to default to general");
  }
  if (/(onclick|script|javascript:)/i.test(globalMessage.text) || !globalMessage.text.includes('href="https://example.com/chat"')) {
    throw new Error("Expected global chat rich text to be sanitized server-side");
  }
  const roomMessage = await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ room: "fandoms", text: "Smoke test fandom room message" })
  });
  if (roomMessage.room !== "fandoms" || roomMessage.text.includes("[#")) {
    throw new Error("Expected global chat room to be stored as a real room field");
  }
  const fandomRoomMessages = await request("/chat/messages?room=fandoms", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!fandomRoomMessages.some((message) => message.id === roomMessage.id) || fandomRoomMessages.some((message) => message.id === globalMessage.id)) {
    throw new Error("Expected global chat room query to return only requested room messages");
  }
  const firstGlobalLike = await request(`/chat/messages/${globalMessage.id}/like`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!firstGlobalLike.liked || firstGlobalLike.likes < 1) {
    throw new Error("Expected first global chat like to be active with a count");
  }
  const chatMessagesAfterLike = await request("/chat/messages");
  if (!chatMessagesAfterLike.some((message) => message.id === globalMessage.id && message.likes >= 1)) {
    throw new Error("Expected global chat messages to include persisted like counts");
  }
  const chatMessagesAfterLikeForViewer = await request("/chat/messages", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!chatMessagesAfterLikeForViewer.some((message) => message.id === globalMessage.id && message.likedByMe === true)) {
    throw new Error("Expected global chat messages to include viewer like state");
  }
  const secondGlobalLike = await request(`/chat/messages/${globalMessage.id}/like`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (secondGlobalLike.liked || secondGlobalLike.likes !== 0) {
    throw new Error("Expected second global chat like to remove the like");
  }
  const chatMessagesAfterUnlike = await request("/chat/messages");
  if (chatMessagesAfterUnlike.some((message) => message.id === globalMessage.id && message.likes > 0)) {
    throw new Error("Expected removed global chat like not to keep increasing");
  }
  const firstReaction = await request(`/chat/messages/${globalMessage.id}/react`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ emoji: "✨" })
  });
  if (!firstReaction.reacted || firstReaction.count < 1) {
    throw new Error("Expected first global chat reaction to be active with a count");
  }
  const switchedReaction = await request(`/chat/messages/${globalMessage.id}/react`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ emoji: "❤️" })
  });
  if (!switchedReaction.reacted || switchedReaction.count < 1 || !switchedReaction.removedReactions?.some((reaction) => reaction.emoji === "✨" && reaction.count === 0)) {
    throw new Error("Expected switching global chat reaction to replace the previous user reaction");
  }
  const chatMessagesAfterReactionForViewer = await request("/chat/messages", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  const reactedViewerMessage = chatMessagesAfterReactionForViewer.find((message) => message.id === globalMessage.id);
  if (!reactedViewerMessage?.reactedByMe?.["❤️"] || reactedViewerMessage?.reactedByMe?.["✨"]) {
    throw new Error("Expected global chat messages to include viewer reaction state");
  }
  const secondReaction = await request(`/chat/messages/${globalMessage.id}/react`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ emoji: "❤️" })
  });
  if (secondReaction.reacted || secondReaction.count !== 0) {
    throw new Error("Expected second identical global chat reaction to remove the reaction");
  }
  await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: "Smoke test quoted global chat message", quotedGlobalMessageId: globalMessage.id })
  });
  const drawingMessage = await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: "Smoke test canvas drawing", drawingUrl: uploadedDrawing.url })
  });
  if (drawingMessage.drawings?.[0]?.imageUrl !== uploadedDrawing.url) {
    throw new Error("Expected global chat to persist uploaded drawing URL");
  }
  const drawingOnlyMessage = await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ drawingUrl: uploadedDrawing.url })
  });
  if (drawingOnlyMessage.text !== "Отправлен рисунок с мини-холста" || drawingOnlyMessage.drawings?.[0]?.imageUrl !== uploadedDrawing.url) {
    throw new Error("Expected drawing-only global chat message to get default text and persist drawing URL");
  }
  const deleteDrawingUpload = await request("/uploads/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ purpose: "drawing", dataUrl: TINY_PNG })
  });
  const deleteDrawingMessage = await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ drawingUrl: deleteDrawingUpload.url })
  });
  await request(`/chat/messages/${deleteDrawingMessage.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  const deletedDrawingResponse = await fetch(deleteDrawingUpload.url);
  if (deletedDrawingResponse.ok) {
    throw new Error("Expected deleted global chat message drawing file to be removed");
  }
  await request(`/chat/messages/${globalMessage.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  const deletedLike = await requestRaw(`/chat/messages/${globalMessage.id}/like`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (deletedLike.ok) throw new Error("Expected like on deleted global message to fail");
  const deletedQuote = await requestRaw("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: "Smoke test deleted quote should fail", quotedGlobalMessageId: globalMessage.id })
  });
  if (deletedQuote.ok) throw new Error("Expected quote of deleted global message to fail");
  const deletedGlobalReport = await requestRaw("/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      entityType: "GLOBAL_CHAT_MESSAGE",
      entityId: globalMessage.id,
      reason: "SPAM",
      comment: "Smoke test deleted global message report"
    })
  });
  if (deletedGlobalReport.ok) throw new Error("Expected report for deleted global message to fail");

  await request("/conversations", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });

  const arlen = await request("/profiles/arlen");
  const arlenInboxSession = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "arlen@cofind.local", password: "password123" })
  });
  const missingConversationUser = await requestRaw("/conversations", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      participantIds: ["missing-user-id"],
      initialMessage: "Smoke test missing participant"
    })
  });
  if (missingConversationUser.ok || missingConversationUser.status !== 404) {
    throw new Error("Expected conversation with missing participant to fail with 404");
  }
  const foreignDeleteGlobalMessage = await request("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: "Smoke test foreign global delete" })
  });
  const foreignGlobalDelete = await requestRaw(`/chat/messages/${foreignDeleteGlobalMessage.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${arlenInboxSession.accessToken}` }
  });
  if (foreignGlobalDelete.ok || foreignGlobalDelete.status !== 404) {
    throw new Error("Expected deleting another user's global message to fail with 404");
  }
  await request(`/chat/messages/${foreignDeleteGlobalMessage.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  const conversation = await request("/conversations", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      participantIds: [` ${arlen.user.id} `, arlen.user.id],
      initialMessage: "Smoke test conversation"
    })
  });
  if (conversation.participants?.length !== 2) {
    throw new Error("Expected conversation participant ids to be trimmed and deduplicated");
  }
  const directConversation = await request("/conversations/direct", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      participantId: resetUser.user.id,
      initialMessage: "Smoke test direct profile message"
    })
  });
  if (directConversation.participants?.length !== 2 || directConversation.messages?.[0]?.text !== "Smoke test direct profile message") {
    throw new Error("Expected direct conversation endpoint to create two-person dialog with initial message");
  }
  const directConversationAgain = await request("/conversations/direct", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ participantId: resetUser.user.id })
  });
  if (directConversationAgain.id !== directConversation.id) {
    throw new Error("Expected direct conversation endpoint to reuse existing dialog");
  }
  const selfDirectConversation = await requestRaw("/conversations/direct", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ participantId: session.user.id })
  });
  if (selfDirectConversation.ok || selfDirectConversation.status !== 403) {
    throw new Error("Expected direct conversation with self to fail with 403");
  }
  const arlenConversationsBeforeRead = await request("/conversations", {
    headers: { Authorization: `Bearer ${arlenInboxSession.accessToken}` }
  });
  const arlenConversationBeforeRead = arlenConversationsBeforeRead.find((item) => item.id === conversation.id);
  if (!arlenConversationBeforeRead || arlenConversationBeforeRead.unreadCount < 1) {
    throw new Error("Expected unread private conversation count for recipient");
  }
  await request(`/conversations/${conversation.id}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenInboxSession.accessToken}` }
  });
  const arlenConversationsAfterRead = await request("/conversations", {
    headers: { Authorization: `Bearer ${arlenInboxSession.accessToken}` }
  });
  const arlenConversationAfterRead = arlenConversationsAfterRead.find((item) => item.id === conversation.id);
  if (arlenConversationAfterRead?.unreadCount !== 0) {
    throw new Error("Expected read private conversation to clear unread count");
  }

  const privateMessage = await request(`/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: "Smoke test private message" })
  });
  const privateMessages = await request(`/conversations/${conversation.id}/messages`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!privateMessages.some((message) => message.id === privateMessage.id)) {
    throw new Error("Expected sent private message in conversation history");
  }
  const foreignPrivateDelete = await requestRaw(`/conversations/${conversation.id}/messages/${privateMessage.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${arlenInboxSession.accessToken}` }
  });
  if (foreignPrivateDelete.ok || foreignPrivateDelete.status !== 404) {
    throw new Error("Expected deleting another user's private message to fail with 404");
  }
  await request(`/conversations/${conversation.id}/messages/${privateMessage.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  const afterDeletePrivateMessages = await request(`/conversations/${conversation.id}/messages`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (afterDeletePrivateMessages.some((message) => message.id === privateMessage.id)) {
    throw new Error("Expected deleted private message to disappear from history");
  }
  const deletedPrivateReport = await requestRaw("/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      entityType: "PRIVATE_MESSAGE",
      entityId: privateMessage.id,
      reason: "SPAM",
      comment: "Smoke test deleted private message report"
    })
  });
  if (deletedPrivateReport.ok) {
    throw new Error("Expected report for deleted private message to fail");
  }
  const secondPrivateMessage = await request(`/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: "Smoke test private message after delete" })
  });
  const olderPrivateMessages = await request(`/conversations/${conversation.id}/messages?cursor=${secondPrivateMessage.id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!Array.isArray(olderPrivateMessages) || olderPrivateMessages.some((message) => message.id === secondPrivateMessage.id)) {
    throw new Error("Expected cursor-paginated private messages to return older messages only");
  }
  const missingPrivateCursor = await requestRaw(`/conversations/${conversation.id}/messages?cursor=missing-private-message-cursor`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (missingPrivateCursor.ok || missingPrivateCursor.status !== 404) {
    throw new Error("Expected missing private message cursor to fail with 404");
  }
  const missingBlock = await requestRaw("/me/blocks", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ userId: "missing-user-id" })
  });
  if (missingBlock.ok || missingBlock.status !== 404) {
    throw new Error("Expected blocking missing user to return 404");
  }
  const missingReport = await requestRaw("/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      entityType: "PRIVATE_MESSAGE",
      entityId: "missing-message-id",
      reason: "SPAM",
      comment: "Smoke test invalid report"
    })
  });
  if (missingReport.ok) {
    throw new Error("Expected report for missing entity to fail");
  }
  const profileReport = await request("/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      entityType: "PROFILE",
      entityId: resetUser.user.id,
      reason: "RULES_VIOLATION",
      comment: "Smoke test profile report"
    })
  });
  if (profileReport.entityType !== "PROFILE" || profileReport.entityId !== resetUser.user.id) {
    throw new Error("Expected profile report to be created for user id");
  }
  const report = await request("/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenInboxSession.accessToken}` },
    body: JSON.stringify({
      entityType: "PRIVATE_MESSAGE",
      entityId: secondPrivateMessage.id,
      reason: "SPAM",
      comment: "Smoke test private message report"
    })
  });
  const duplicateReport = await requestRaw("/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenInboxSession.accessToken}` },
    body: JSON.stringify({
      entityType: "PRIVATE_MESSAGE",
      entityId: secondPrivateMessage.id,
      reason: "SPAM",
      comment: "Smoke test duplicate private message report"
    })
  });
  if (duplicateReport.ok) {
    throw new Error("Expected duplicate active report to fail");
  }
  const myReports = await request("/reports/my", {
    headers: { Authorization: `Bearer ${arlenInboxSession.accessToken}` }
  });
  if (!myReports.some((item) => item.id === report.id)) {
    throw new Error("Expected report in reports/my");
  }
  const pagedMyReports = await request("/reports/my?page=1&pageSize=2", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!pagedMyReports.pagination || pagedMyReports.pagination.pageSize !== 2 || !Array.isArray(pagedMyReports.hits)) {
    throw new Error("Expected paginated reports/my response when page is requested");
  }
  await request("/me/blocks", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ userId: arlen.user.id })
  });
  const blockedPrivateMessage = await requestRaw(`/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ text: "Smoke test blocked private message" })
  });
  if (blockedPrivateMessage.ok) {
    throw new Error("Expected private message to blocked user to fail");
  }
  await request(`/me/blocks/${arlen.user.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });

  const moderator = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "mod@cofind.local", password: "password123" })
  });
  const missingAdminStatus = await requestRaw("/admin/users/missing-user-id/status", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ status: "ACTIVE" })
  });
  if (missingAdminStatus.ok || missingAdminStatus.status !== 404) {
    throw new Error("Expected admin status update for missing user to fail with 404");
  }
  const missingAdminBan = await requestRaw("/admin/users/missing-user-id/ban", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ type: "TEMP_BAN", reason: "Smoke test missing user ban" })
  });
  if (missingAdminBan.ok || missingAdminBan.status !== 404) {
    throw new Error("Expected admin ban for missing user to fail with 404");
  }
  const missingAdminUnban = await requestRaw("/admin/users/missing-user-id/unban", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` }
  });
  if (missingAdminUnban.ok || missingAdminUnban.status !== 404) {
    throw new Error("Expected admin unban for missing user to fail with 404");
  }
  const missingAdminListing = await requestRaw("/admin/listings/missing-listing-id/moderate", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ moderationStatus: "APPROVED" })
  });
  if (missingAdminListing.ok || missingAdminListing.status !== 404) {
    throw new Error("Expected admin moderation for missing listing to fail with 404");
  }
  const missingAdminReport = await requestRaw("/admin/reports/missing-report-id", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ status: "RESOLVED", resolutionComment: "Smoke test missing report" })
  });
  if (missingAdminReport.ok || missingAdminReport.status !== 404) {
    throw new Error("Expected admin resolve for missing report to fail with 404");
  }
  const missingAdminSuggestion = await requestRaw("/admin/suggestions/missing-suggestion-id", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ status: "APPROVED", moderatorComment: "Smoke test missing suggestion" })
  });
  if (missingAdminSuggestion.ok || missingAdminSuggestion.status !== 404) {
    throw new Error("Expected admin moderation for missing suggestion to fail with 404");
  }
  const resolvedReport = await request(`/admin/reports/${report.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ status: "RESOLVED", resolutionComment: "Smoke test report resolved" })
  });
  if (resolvedReport.status !== "RESOLVED" || !resolvedReport.moderatorId) {
    throw new Error("Expected admin report resolution to persist");
  }
  const approvedSuggestion = await request(`/admin/suggestions/${suggestion.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ status: "APPROVED", moderatorComment: "Smoke test suggestion approved" })
  });
  if (approvedSuggestion.status !== "APPROVED" || !approvedSuggestion.reviewedById) {
    throw new Error("Expected admin suggestion moderation to persist");
  }
  const lysa = await request("/profiles/lysa");
  const lysaPublicListing = lysa.user?.listings?.[0];
  await request("/me/blocks", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ userId: lysa.user.id })
  });
  const blockedConversation = await requestRaw("/conversations", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      participantIds: [lysa.user.id],
      initialMessage: "Smoke test blocked conversation"
    })
  });
  if (blockedConversation.ok) {
    throw new Error("Expected conversation with blocked user to fail");
  }
  await request(`/me/blocks/${lysa.user.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  await request(`/admin/users/${lysa.user.id}/ban`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      type: "TEMP_BAN",
      reason: "Smoke test temporary ban",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    })
  });
  const blockedLogin = await requestRaw("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "lysa@cofind.local", password: "password123" })
  });
  if (blockedLogin.ok) throw new Error("Expected banned user login to fail");
  const bannedPublicProfile = await requestRaw("/profiles/lysa");
  if (bannedPublicProfile.ok || bannedPublicProfile.status !== 404) {
    throw new Error("Expected banned user public profile to be hidden");
  }
  if (lysaPublicListing) {
    const bannedAuthorListingDetail = await requestRaw(`/listings/${lysaPublicListing.id}`);
    if (bannedAuthorListingDetail.ok || bannedAuthorListingDetail.status !== 404) {
      throw new Error("Expected banned author's listing detail to be hidden");
    }
    const publicSearchAfterBan = await request("/search/listings");
    const publicHitsAfterBan = publicSearchAfterBan.hits || publicSearchAfterBan;
    if (publicHitsAfterBan.some((listing) => listing.id === lysaPublicListing.id)) {
      throw new Error("Expected banned author's listing to be hidden from public search");
    }
    const likeBannedAuthorListing = await requestRaw(`/listings/${lysaPublicListing.id}/like`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    if (likeBannedAuthorListing.ok || likeBannedAuthorListing.status !== 404) {
      throw new Error("Expected like on banned author's listing to fail with 404");
    }
    const responseToBannedAuthor = await requestRaw(`/listings/${lysaPublicListing.id}/respond`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ message: "Smoke test response to banned listing author should fail" })
    });
    if (responseToBannedAuthor.ok || responseToBannedAuthor.status !== 404) {
      throw new Error("Expected response to banned listing author to fail with 404");
    }
  }
  const conversationWithBannedUser = await requestRaw("/conversations", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      participantIds: [lysa.user.id],
      initialMessage: "Smoke test conversation with banned user should fail"
    })
  });
  if (conversationWithBannedUser.ok || conversationWithBannedUser.status !== 403) {
    throw new Error("Expected conversation with banned user to fail with 403");
  }
  await request(`/admin/users/${lysa.user.id}/unban`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` }
  });
  await request(`/admin/users/${lysa.user.id}/ban`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      type: "TEMP_BAN",
      reason: "Smoke test already expired temporary ban",
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    })
  });
  const expiredBanLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "lysa@cofind.local", password: "password123" })
  });
  const expiredBanMe = await request("/auth/me", {
    headers: { Authorization: `Bearer ${expiredBanLogin.accessToken}` }
  });
  if (expiredBanMe.status !== "ACTIVE") {
    throw new Error("Expected expired temporary ban to be reconciled automatically");
  }
  await request(`/admin/users/${lysa.user.id}/ban`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      type: "MUTE",
      reason: "Smoke test mute"
    })
  });
  const mutedChat = await requestRaw("/chat/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${expiredBanLogin.accessToken}` },
    body: JSON.stringify({ text: "Smoke test muted chat should fail" })
  });
  if (mutedChat.ok) {
    throw new Error("Expected muted user chat message to fail");
  }
  const mutedConversation = await requestRaw("/conversations", {
    method: "POST",
    headers: { Authorization: `Bearer ${expiredBanLogin.accessToken}` },
    body: JSON.stringify({
      participantIds: [arlen.user.id],
      initialMessage: "Smoke test muted conversation should fail"
    })
  });
  if (mutedConversation.ok) {
    throw new Error("Expected muted user conversation to fail");
  }
  await request(`/admin/users/${lysa.user.id}/unban`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` }
  });
  const smokeTagSlug = `smoke-tag-${Date.now()}`;
  await request(`/admin/tags/${smokeTagSlug}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      slug: smokeTagSlug,
      name: smokeTagSlug,
      description: "Smoke test tag",
      status: "APPROVED"
    })
  });
  const adminTags = await request("/admin/tags", {
    headers: { Authorization: `Bearer ${moderator.accessToken}` }
  });
  if (!adminTags.some((tag) => tag.slug === smokeTagSlug)) {
    throw new Error("Expected upserted admin tag in admin/tags");
  }
  const invalidAdminTagSlug = await requestRaw("/admin/tags/Bad_Slug", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      slug: "valid-body-slug",
      name: "Smoke invalid tag slug",
      description: "Smoke invalid path slug",
      status: "APPROVED"
    })
  });
  if (invalidAdminTagSlug.ok || invalidAdminTagSlug.status !== 400) {
    throw new Error("Expected invalid admin tag path slug to fail with 400");
  }
  const hiddenTagSlug = `smoke-hidden-tag-${Date.now()}`;
  await request(`/admin/tags/${hiddenTagSlug}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      slug: hiddenTagSlug,
      name: hiddenTagSlug,
      description: "Smoke hidden tag",
      status: "HIDDEN"
    })
  });
  const hiddenCatalogListing = await requestRaw("/listings", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({
      type: "COAUTHOR_SEARCH",
      title: `Smoke hidden catalog listing ${Date.now()}`,
      body: "Temporary smoke-test listing used to verify hidden catalog slugs are rejected by listing creation.",
      ageRating: "TEEN",
      tagSlugs: [hiddenTagSlug]
    })
  });
  if (hiddenCatalogListing.ok || hiddenCatalogListing.status !== 400) {
    throw new Error("Expected listing with hidden catalog slug to fail with 400");
  }
  const duplicateAdminTagName = await requestRaw(`/admin/tags/${smokeTagSlug}-duplicate`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      slug: `${smokeTagSlug}-duplicate`,
      name: smokeTagSlug.toUpperCase(),
      description: "Smoke duplicate tag name",
      status: "APPROVED"
    })
  });
  if (duplicateAdminTagName.ok || duplicateAdminTagName.status !== 400) {
    throw new Error("Expected admin catalog duplicate name to fail with 400");
  }
  const missingCharacterFandomSlug = `smoke-missing-fandom-${Date.now()}`;
  const missingCharacterFandom = await requestRaw(`/admin/characters/${missingCharacterFandomSlug}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      slug: missingCharacterFandomSlug,
      name: "Smoke missing fandom character",
      description: "Smoke character with invalid fandom",
      status: "APPROVED",
      fandomId: "missing-fandom-id"
    })
  });
  if (missingCharacterFandom.ok || missingCharacterFandom.status !== 404) {
    throw new Error("Expected admin character with missing fandom to fail with 404");
  }
  const smokeAd = await request("/admin/ads/new", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      name: `Smoke ad ${Date.now()}`,
      position: "FEED",
      status: "DRAFT",
      clickUrl: "https://example.local",
      hideForPremium: true
    })
  });
  if (smokeAd.target?.hideForPremium !== true) {
    throw new Error("Expected admin ad hideForPremium target to persist");
  }
  const adminAds = await request("/admin/ads", {
    headers: { Authorization: `Bearer ${moderator.accessToken}` }
  });
  if (!adminAds.some((ad) => ad.id === smokeAd.id)) {
    throw new Error("Expected created ad in admin/ads");
  }
  const invalidAdUrl = await requestRaw("/admin/ads/new", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      name: `Smoke invalid ad url ${Date.now()}`,
      position: "FEED",
      status: "DRAFT",
      clickUrl: "ftp://example.local/ad",
      imageUrl: "javascript:alert(1)"
    })
  });
  if (invalidAdUrl.ok || invalidAdUrl.status !== 400) {
    throw new Error("Expected unsafe admin ad URLs to fail with 400");
  }
  const oversizedAdHtml = await requestRaw("/admin/ads/new", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      name: `Smoke oversized ad html ${Date.now()}`,
      position: "FEED",
      status: "DRAFT",
      htmlCode: "x".repeat(4001)
    })
  });
  if (oversizedAdHtml.ok || oversizedAdHtml.status !== 400) {
    throw new Error("Expected oversized admin ad html to fail with 400");
  }
  const cappedAd = await request("/admin/ads/new", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      name: `Smoke capped ad ${Date.now()}`,
      position: "FEED",
      status: "ACTIVE",
      clickUrl: "https://example.local/capped",
      impressionLimit: 0
    })
  });
  const publicFeedAds = await request("/ads/placements?position=FEED");
  if (publicFeedAds.some((ad) => ad.id === cappedAd.id)) {
    throw new Error("Expected capped ad placement to be hidden from public ads");
  }
  const futureAd = await request("/admin/ads/new", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      name: `Smoke future ad ${Date.now()}`,
      position: "FEED",
      status: "ACTIVE",
      clickUrl: "https://example.local/future",
      startsAt: new Date(Date.now() + 86_400_000).toISOString()
    })
  });
  const publicFeedAdsWithoutFuture = await request("/ads/placements?position=FEED");
  if (publicFeedAdsWithoutFuture.some((ad) => ad.id === futureAd.id)) {
    throw new Error("Expected future ad placement to be hidden from public ads");
  }
  const invalidAdSchedule = await requestRaw("/admin/ads/new", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      name: `Smoke invalid ad schedule ${Date.now()}`,
      position: "FEED",
      status: "ACTIVE",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() - 86_400_000).toISOString()
    })
  });
  if (invalidAdSchedule.ok || invalidAdSchedule.status !== 400) {
    throw new Error("Expected invalid ad schedule to fail with 400");
  }
  const invalidPlanCode = await requestRaw("/admin/subscription-plans/Bad_Code", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      code: "valid-plan-code",
      name: "Smoke invalid plan code",
      description: "Smoke invalid plan code from path",
      priceCents: 100,
      durationDays: 1,
      isActive: true
    })
  });
  if (invalidPlanCode.ok || invalidPlanCode.status !== 400) {
    throw new Error("Expected invalid subscription plan path code to fail with 400");
  }
  const missingAdminAd = await requestRaw("/admin/ads/missing-ad-id", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({
      name: "Missing smoke ad",
      position: "FEED",
      status: "DRAFT"
    })
  });
  if (missingAdminAd.ok || missingAdminAd.status !== 404) {
    throw new Error("Expected admin ad update for missing placement to fail with 404");
  }

  const owner = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "owner@cofind.local", password: "password123" })
  });
  const ownerMe = await request("/auth/me", {
    headers: { Authorization: `Bearer ${owner.accessToken}` }
  });
  const selfRoleChange = await requestRaw(`/admin/users/${ownerMe.id}/role`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ role: "USER" })
  });
  if (selfRoleChange.ok || selfRoleChange.status !== 400) {
    throw new Error("Expected admin self role change to fail with 400");
  }
  const selfBan = await requestRaw(`/admin/users/${ownerMe.id}/ban`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ type: "TEMP_BAN", reason: "Smoke test self ban should fail" })
  });
  if (selfBan.ok || selfBan.status !== 400) {
    throw new Error("Expected admin self ban to fail with 400");
  }
  const moderatorOwnerBan = await requestRaw(`/admin/users/${ownerMe.id}/ban`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ type: "TEMP_BAN", reason: "Smoke test moderator should not ban owner" })
  });
  if (moderatorOwnerBan.ok || moderatorOwnerBan.status !== 403) {
    throw new Error("Expected moderator ban against owner to fail with 403");
  }
  const disabledAdminSettings = await request("/admin/settings", {
    headers: { Authorization: `Bearer ${owner.accessToken}` }
  });
  if (disabledAdminSettings.monetizationEnabled !== false) {
    throw new Error("Expected admin settings to expose disabled monetization by default");
  }
  const disabledCheckout = await requestRaw("/me/subscription/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ planCode: "premium-monthly" })
  });
  if (disabledCheckout.ok || disabledCheckout.status !== 403) {
    throw new Error("Expected checkout to be blocked while monetization is disabled");
  }
  const enabledAdminSettings = await request("/admin/settings", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ monetizationEnabled: true })
  });
  if (enabledAdminSettings.monetizationEnabled !== true) {
    throw new Error("Expected owner to enable monetization");
  }
  const enabledPlans = await request("/subscription/plans");
  if (!Array.isArray(enabledPlans) || !enabledPlans.some((plan) => plan.code === "premium-monthly")) {
    throw new Error("Expected public plans to appear after monetization is enabled");
  }
  const restoredDeactivated = await request(`/admin/users/${deactivateSession.user.id}/unban`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` }
  });
  if (restoredDeactivated.status !== "ACTIVE") {
    throw new Error("Expected owner to restore deactivated account status to ACTIVE");
  }
  const restoredOldPasswordLogin = await requestRaw("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: deactivateEmail, password: "password123" })
  });
  if (restoredOldPasswordLogin.ok || restoredOldPasswordLogin.status !== 401) {
    throw new Error("Expected restored deactivated account to still require password reset");
  }
  const adminActorUser = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `admin-actor-${Date.now()}@cofind.local`,
      username: `adminactor${Date.now()}`,
      displayName: "Admin Actor Smoke",
      password: "password123"
    })
  });
  const adminTargetUser = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `admin-target-${Date.now()}@cofind.local`,
      username: `admintarget${Date.now()}`,
      displayName: "Admin Target Smoke",
      password: "password123"
    })
  });
  await request(`/admin/users/${adminActorUser.user.id}/role`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ role: "ADMIN" })
  });
  const adminActorLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: adminActorUser.user.email, password: "password123" })
  });
  const adminAssignAdmin = await requestRaw(`/admin/users/${adminTargetUser.user.id}/role`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${adminActorLogin.accessToken}` },
    body: JSON.stringify({ role: "ADMIN" })
  });
  if (adminAssignAdmin.ok || adminAssignAdmin.status !== 403) {
    throw new Error("Expected admin assigning equal role to fail with 403");
  }
  const reindex = await request("/search/reindex", {
    method: "POST",
    headers: { Authorization: `Bearer ${owner.accessToken}` }
  });
  if (typeof reindex.indexed !== "number" || !reindex.deleteTask) {
    throw new Error("Expected search reindex to rebuild index and return delete task");
  }
  const reindexedUppercaseSearch = await request("/search/listings?genre=FANTASY");
  if (reindexedUppercaseSearch.source !== "meilisearch" || !(reindexedUppercaseSearch.hits || []).some((listing) => listing.genreSlugs?.includes?.("fantasy"))) {
    throw new Error("Expected reindexed Meilisearch catalog terms to accept uppercase slugs");
  }
  const missingOwnerRoleChange = await requestRaw("/admin/users/missing-user-id/role", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ role: "USER" })
  });
  if (missingOwnerRoleChange.ok || missingOwnerRoleChange.status !== 404) {
    throw new Error("Expected admin role update for missing user to fail with 404");
  }
  const smokeSeoPath = `/smoke-seo-${Date.now()}`;
  const smokeSeoPage = await request("/admin/seo-pages", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({
      path: smokeSeoPath,
      title: "Smoke SEO page",
      description: "Smoke test SEO description",
      h1: "Smoke SEO",
      indexable: false
    })
  });
  const adminSeoPages = await request("/admin/seo-pages", {
    headers: { Authorization: `Bearer ${owner.accessToken}` }
  });
  if (!adminSeoPages.some((page) => page.id === smokeSeoPage.id)) {
    throw new Error("Expected upserted SEO page in admin/seo-pages");
  }
  const publicSeoPage = await request(`/seo/page?path=${encodeURIComponent(smokeSeoPath)}`);
  if (publicSeoPage.title !== "Smoke SEO page" || publicSeoPage.indexable !== false) {
    throw new Error("Expected public seo/page to return upserted SEO data");
  }
  const smokeSeoPathWithoutSlash = `smoke-seo-noslash-${Date.now()}`;
  const smokeSeoNoSlashPage = await request("/admin/seo-pages", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({
      path: smokeSeoPathWithoutSlash,
      title: "Smoke SEO normalized page",
      description: "Smoke test normalized SEO description",
      h1: "Smoke SEO Normalized",
      indexable: true
    })
  });
  if (smokeSeoNoSlashPage.path !== `/${smokeSeoPathWithoutSlash}`) {
    throw new Error("Expected admin seo/page to normalize path with leading slash");
  }
  const publicSeoNoSlashPage = await request(`/seo/page?path=${encodeURIComponent(smokeSeoPathWithoutSlash)}`);
  if (publicSeoNoSlashPage.title !== "Smoke SEO normalized page") {
    throw new Error("Expected public seo/page to normalize query path with leading slash");
  }
  const auditLog = await request("/admin/audit-log", {
    headers: { Authorization: `Bearer ${owner.accessToken}` }
  });
  for (const action of ["UPSERT_TAG", "UPSERT_AD", "UPSERT_SEO_PAGE", "RESOLVE_REPORT", "MODERATE_SUGGESTION"]) {
    if (!auditLog.some((entry) => entry.action === action)) {
      throw new Error(`Expected audit log to include ${action}`);
    }
  }
  await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "lysa@cofind.local", password: "password123" })
  });

  const arlenSession = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "arlen@cofind.local", password: "password123" })
  });
  const invalidCatalogListing = await requestRaw("/listings", {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` },
    body: JSON.stringify({
      type: "ROLEPLAY_SEARCH",
      title: `Smoke invalid catalog ${Date.now()}`,
      body: "Temporary smoke-test listing used to verify invalid catalog slugs are rejected.",
      ageRating: "TEEN",
      tagSlugs: ["missing-smoke-tag"]
    })
  });
  if (invalidCatalogListing.ok || invalidCatalogListing.status !== 400) {
    throw new Error("Expected listing with missing catalog slug to fail with 400");
  }
  const oversizedListing = await requestRaw("/listings", {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` },
    body: JSON.stringify({
      type: "ROLEPLAY_SEARCH",
      title: `Smoke oversized body ${Date.now()}`,
      body: "x".repeat(4001),
      ageRating: "TEEN"
    })
  });
  if (oversizedListing.ok || oversizedListing.status !== 400) {
    throw new Error("Expected listing body longer than 4000 chars to fail with 400");
  }
  const smokeListing = await request("/listings", {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` },
    body: JSON.stringify({
      type: "ROLEPLAY_SEARCH",
      title: `Smoke inbox flow ${Date.now()}`,
      body: '<p onclick="alert(1)">Temporary smoke-test listing used to verify response inbox flow. <script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.com/listing">safe</a></p>',
      ageRating: "TEEN",
      tagSlugs: [" Slow-Burn ", "slow-burn"],
      genreSlugs: [" Fantasy "],
      fandomSlugs: [" Originals "],
      characterSlugs: [" Original-Character "]
    })
  });
  if (
    !smokeListing.tags?.some((item) => item.tag?.slug === "slow-burn") ||
    !smokeListing.genres?.some((item) => item.genre?.slug === "fantasy") ||
    !smokeListing.fandoms?.some((item) => item.fandom?.slug === "originals") ||
    !smokeListing.characters?.some((item) => item.character?.slug === "original-character")
  ) {
    throw new Error("Expected created listing to keep selected catalog relations");
  }
  if (smokeListing.tags.filter((item) => item.tag?.slug === "slow-burn").length !== 1) {
    throw new Error("Expected duplicate listing catalog slugs to be deduplicated");
  }
  if (/(onclick|script|javascript:)/i.test(smokeListing.body) || !smokeListing.body.includes('href="https://example.com/listing"')) {
    throw new Error("Expected listing rich text to be sanitized server-side");
  }
  const arlenListings = await request("/listings/mine", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!arlenListings.some((listing) => listing.id === smokeListing.id)) {
    throw new Error("Expected created listing in listings/mine");
  }
  const pagedMineListings = await request("/listings/mine?page=1&pageSize=2", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!pagedMineListings.pagination || pagedMineListings.pagination.pageSize !== 2 || !Array.isArray(pagedMineListings.hits)) {
    throw new Error("Expected paginated listings/mine response when page is requested");
  }
  const publicDraft = await requestRaw(`/listings/${smokeListing.id}`);
  if (publicDraft.ok) {
    throw new Error("Expected unpublished listing to be hidden from public detail");
  }
  await request(`/listings/mine/${smokeListing.id}`, {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  const updatedSmokeListing = await request(`/listings/${smokeListing.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` },
    body: JSON.stringify({
      title: `${smokeListing.title} edited`,
      body: "Temporary smoke-test listing updated through the owner listing editor.",
      tagSlugs: ["oc"],
      genreSlugs: ["drama"],
      fandomSlugs: ["originals"],
      characterSlugs: ["original-character"]
    })
  });
  if (updatedSmokeListing.title !== `${smokeListing.title} edited` || !updatedSmokeListing.tags?.some((item) => item.tag?.slug === "oc")) {
    throw new Error("Expected own listing update to persist fields and relations");
  }
  const blockedDraftResponse = await requestRaw(`/listings/${smokeListing.id}/respond`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ message: "Smoke response should not be accepted while listing is draft" })
  });
  if (blockedDraftResponse.ok) {
    throw new Error("Expected response to draft listing to fail");
  }
  const foreignListingClose = await requestRaw(`/listings/${smokeListing.id}/close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (foreignListingClose.ok || foreignListingClose.status !== 404) {
    throw new Error("Expected closing another user's listing to fail with 404");
  }
  await request(`/listings/${smokeListing.id}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  const publicPending = await requestRaw(`/listings/${smokeListing.id}`);
  if (publicPending.ok) {
    throw new Error("Expected pending listing to stay hidden from public detail");
  }
  await request(`/admin/listings/${smokeListing.id}/moderate`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ status: "PUBLISHED", moderationStatus: "APPROVED" })
  });
  const listingAuditLog = await request("/admin/audit-log", {
    headers: { Authorization: `Bearer ${owner.accessToken}` }
  });
  if (!listingAuditLog.some((entry) => entry.action === "MODERATE_LISTING" && entry.entityId === smokeListing.id)) {
    throw new Error("Expected audit log to include listing moderation");
  }
  const publicApproved = await request(`/listings/${smokeListing.id}`);
  if (publicApproved.id !== smokeListing.id) {
    throw new Error("Expected approved listing to be visible through public detail");
  }
  const firstListingLike = await request(`/listings/${smokeListing.id}/like`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!firstListingLike.liked || firstListingLike.likes < 1) {
    throw new Error("Expected first listing like to be active with a count");
  }
  const likedPublicListing = await request(`/listings/${smokeListing.id}`);
  if (likedPublicListing.likes < 1 || typeof likedPublicListing.responses !== "number") {
    throw new Error("Expected public listing detail to include listing metrics");
  }
  const secondListingLike = await request(`/listings/${smokeListing.id}/like`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (secondListingLike.liked || secondListingLike.likes !== 0) {
    throw new Error("Expected second listing like to remove the like");
  }
  await request(`/listings/${smokeListing.id}/like`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  const listingForViewer = await request(`/listings/${smokeListing.id}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (listingForViewer.likedByMe !== true) {
    throw new Error("Expected public listing detail to include viewer like state");
  }
  const likedListings = await request("/me/liked-listings", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!likedListings.some((listing) => listing.id === smokeListing.id && listing.likedByMe === true && listing.likes >= 1)) {
    throw new Error("Expected me/liked-listings to include liked public listing with metrics");
  }
  const pagedLikedListings = await request("/me/liked-listings?page=1&pageSize=2", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!pagedLikedListings.pagination || pagedLikedListings.pagination.pageSize !== 2 || !Array.isArray(pagedLikedListings.hits)) {
    throw new Error("Expected paginated me/liked-listings response when page is requested");
  }
  const searchForViewer = await request("/search/listings?genre=drama&fandom=originals", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!(searchForViewer.hits || []).some((listing) => listing.id === smokeListing.id && listing.likedByMe === true)) {
    throw new Error("Expected search listings to include viewer like state");
  }
  const metricListings = await request("/listings?genre=drama&fandom=originals");
  const metricListing = metricListings.find((listing) => listing.id === smokeListing.id);
  if (!metricListing || metricListing.likes < 1 || typeof metricListing.reports !== "number") {
    throw new Error("Expected public listings endpoint to include listing metrics");
  }
  const arlenNotifications = await request("/notifications", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!arlenNotifications.some((notification) => notification.description?.includes(smokeListing.title))) {
    throw new Error("Expected listing moderation notification for author");
  }
  const listingResponse = await request(`/listings/${smokeListing.id}/respond`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ message: "Smoke test listing response for inbox flow" })
  });
  const duplicateListingResponse = await requestRaw(`/listings/${smokeListing.id}/respond`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ message: "Smoke test duplicate listing response should fail" })
  });
  if (duplicateListingResponse.ok || duplicateListingResponse.status !== 400) {
    throw new Error("Expected duplicate listing response to fail with 400");
  }
  const missingListingLike = await requestRaw("/listings/missing-listing-id/like", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (missingListingLike.ok || missingListingLike.status !== 404) {
    throw new Error("Expected like on missing listing to fail with 404");
  }
  const sentResponses = await request("/listings/mine/responses", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!sentResponses.some((response) => response.id === listingResponse.id)) {
    throw new Error("Expected created response in sender inbox");
  }
  const pagedSentResponses = await request("/listings/mine/responses?page=1&pageSize=2", {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  if (!pagedSentResponses.pagination || pagedSentResponses.pagination.pageSize !== 2 || !Array.isArray(pagedSentResponses.hits)) {
    throw new Error("Expected paginated listings/mine/responses response when page is requested");
  }
  const incomingResponses = await request("/listings/mine/incoming-responses", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!incomingResponses.some((response) => response.id === listingResponse.id)) {
    throw new Error("Expected created response in listing author inbox");
  }
  const pagedIncomingResponses = await request("/listings/mine/incoming-responses?page=1&pageSize=2", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!pagedIncomingResponses.pagination || pagedIncomingResponses.pagination.pageSize !== 2 || !Array.isArray(pagedIncomingResponses.hits)) {
    throw new Error("Expected paginated listings/mine/incoming-responses response when page is requested");
  }
  const pagedListingResponses = await request(`/listings/${smokeListing.id}/responses?page=1&pageSize=2`, {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!pagedListingResponses.pagination || pagedListingResponses.pagination.pageSize !== 2 || !Array.isArray(pagedListingResponses.hits)) {
    throw new Error("Expected paginated listing responses response when page is requested");
  }
  const foreignResponseStatus = await requestRaw(`/listings/responses/${listingResponse.id}/status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ status: "DECLINED" })
  });
  if (foreignResponseStatus.ok || foreignResponseStatus.status !== 404) {
    throw new Error("Expected changing response status by non-author to fail with 404");
  }
  await request(`/listings/responses/${listingResponse.id}/status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` },
    body: JSON.stringify({ status: "ACCEPTED" })
  });
  const terminalResponseStatus = await requestRaw(`/listings/responses/${listingResponse.id}/status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` },
    body: JSON.stringify({ status: "DECLINED" })
  });
  if (terminalResponseStatus.ok || terminalResponseStatus.status !== 400) {
    throw new Error("Expected accepted response status to be terminal");
  }
  const closedListing = await request(`/listings/${smokeListing.id}/close`, {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (closedListing.status !== "CLOSED") throw new Error("Expected owner to close listing");
  const archivedListing = await request(`/listings/${smokeListing.id}/archive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (archivedListing.status !== "ARCHIVED") throw new Error("Expected owner to archive listing");
  const deletedListing = await request(`/listings/${smokeListing.id}/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (deletedListing.status !== "DELETED" || deletedListing.moderationStatus !== "HIDDEN") {
    throw new Error("Expected owner to soft-delete listing");
  }
  const deletedListingPublic = await requestRaw(`/listings/${smokeListing.id}`);
  if (deletedListingPublic.ok || deletedListingPublic.status !== 404) {
    throw new Error("Expected soft-deleted listing to be hidden publicly");
  }
  const ownerListingsAfterDelete = await request("/listings/mine", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (ownerListingsAfterDelete.some((listing) => listing.id === smokeListing.id)) {
    throw new Error("Expected soft-deleted listing to disappear from owner listing list");
  }
  const restoredListing = await request(`/admin/listings/${smokeListing.id}/moderate`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${moderator.accessToken}` },
    body: JSON.stringify({ status: "DRAFT", moderationStatus: "PENDING" })
  });
  if (restoredListing.status !== "DRAFT" || restoredListing.moderationStatus !== "PENDING") {
    throw new Error("Expected staff to restore soft-deleted listing to draft moderation queue");
  }
  const ownerListingsAfterRestore = await request("/listings/mine", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!ownerListingsAfterRestore.some((listing) => listing.id === smokeListing.id)) {
    throw new Error("Expected restored listing to reappear in owner listing list");
  }

  const checkout = await request("/me/subscription/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` },
    body: JSON.stringify({ planCode: " Premium-Monthly " })
  });
  await request("/payments/webhook", {
    method: "POST",
    headers: paymentWebhookHeaders(),
    body: JSON.stringify({
      paymentId: checkout.payment.id,
      status: "SUCCEEDED",
      providerPaymentId: `smoke-${Date.now()}`
    })
  });
  const premiumMe = await request("/auth/me", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!premiumMe.isPremium || !premiumMe.subscription) {
    throw new Error("Expected payment webhook to activate premium subscription");
  }
  const firstExpiresAt = premiumMe.subscription.expiresAt;
  const duplicateWebhook = await request("/payments/webhook", {
    method: "POST",
    headers: paymentWebhookHeaders(),
    body: JSON.stringify({
      paymentId: checkout.payment.id,
      status: "SUCCEEDED",
      providerPaymentId: `smoke-${Date.now()}`
    })
  });
  const duplicateMe = await request("/auth/me", {
    headers: { Authorization: `Bearer ${arlenSession.accessToken}` }
  });
  if (!duplicateWebhook.duplicate || duplicateMe.subscription.expiresAt !== firstExpiresAt) {
    throw new Error("Expected duplicate payment webhook to be idempotent");
  }
  const lateFailedWebhook = await request("/payments/webhook", {
    method: "POST",
    headers: paymentWebhookHeaders(),
    body: JSON.stringify({
      paymentId: checkout.payment.id,
      status: "FAILED",
      providerPaymentId: `smoke-late-fail-${Date.now()}`
    })
  });
  if (!lateFailedWebhook.duplicate || lateFailedWebhook.payment.status !== "SUCCEEDED") {
    throw new Error("Expected late failed webhook after success to be ignored");
  }

  const failedPaymentUser = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `failed-payment-${Date.now()}@cofind.local`,
      username: `failedpay${Date.now()}`,
      displayName: "Failed Payment Smoke",
      password: "password123"
    })
  });
  const failedCheckout = await request("/me/subscription/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${failedPaymentUser.accessToken}` },
    body: JSON.stringify({ planCode: "premium-monthly" })
  });
  await request("/payments/webhook", {
    method: "POST",
    headers: paymentWebhookHeaders(),
    body: JSON.stringify({
      paymentId: failedCheckout.payment.id,
      status: "FAILED",
      providerPaymentId: `smoke-failed-${Date.now()}`
    })
  });
  const lateSuccessWebhook = await request("/payments/webhook", {
    method: "POST",
    headers: paymentWebhookHeaders(),
    body: JSON.stringify({
      paymentId: failedCheckout.payment.id,
      status: "SUCCEEDED",
      providerPaymentId: `smoke-late-success-${Date.now()}`
    })
  });
  const failedPaymentMe = await request("/auth/me", {
    headers: { Authorization: `Bearer ${failedPaymentUser.accessToken}` }
  });
  if (!lateSuccessWebhook.duplicate || lateSuccessWebhook.payment.status !== "FAILED" || failedPaymentMe.isPremium) {
    throw new Error("Expected late success webhook after failure to be ignored");
  }

  const premiumRoleUser = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `premium-role-${Date.now()}@cofind.local`,
      username: `premiumrole${Date.now()}`,
      displayName: "Premium Role Smoke",
      password: "password123"
    })
  });
  const premiumRoleCheckout = await request("/me/subscription/checkout", {
    method: "POST",
    headers: { Authorization: `Bearer ${premiumRoleUser.accessToken}` },
    body: JSON.stringify({ planCode: "premium-monthly" })
  });
  await request("/payments/webhook", {
    method: "POST",
    headers: paymentWebhookHeaders(),
    body: JSON.stringify({
      paymentId: premiumRoleCheckout.payment.id,
      status: "SUCCEEDED",
      providerPaymentId: `smoke-role-${Date.now()}`
    })
  });
  const premiumRoleMe = await request("/auth/me", {
    headers: { Authorization: `Bearer ${premiumRoleUser.accessToken}` }
  });
  if (!premiumRoleMe.isPremium || premiumRoleMe.role !== "USER") {
    throw new Error("Expected premium payment to keep account role unchanged");
  }
  await request(`/admin/users/${premiumRoleMe.id}/role`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ role: "USER" })
  });
  const premiumAfterRoleChange = await request("/auth/me", {
    headers: { Authorization: `Bearer ${premiumRoleUser.accessToken}` }
  });
  if (!premiumAfterRoleChange.isPremium || premiumAfterRoleChange.role !== "USER") {
    throw new Error("Expected admin role update to keep active premium flag");
  }
  const canceledPremium = await request("/me/subscription/cancel", {
    method: "POST",
    headers: { Authorization: `Bearer ${premiumRoleUser.accessToken}` }
  });
  if (!canceledPremium.canceled || canceledPremium.subscription.status !== "CANCELED" || !canceledPremium.subscription.canceledAt) {
    throw new Error("Expected premium subscription cancel to mark subscription as canceled");
  }
  const canceledPremiumMe = await request("/auth/me", {
    headers: { Authorization: `Bearer ${premiumRoleUser.accessToken}` }
  });
  if (canceledPremiumMe.isPremium || canceledPremiumMe.subscription.status !== "CANCELED") {
    throw new Error("Expected canceled premium subscription to disable premium flag");
  }
  const duplicateCancel = await request("/me/subscription/cancel", {
    method: "POST",
    headers: { Authorization: `Bearer ${premiumRoleUser.accessToken}` }
  });
  if (duplicateCancel.canceled) {
    throw new Error("Expected duplicate premium cancel to be idempotent");
  }
  const legacyPayments = await request("/me/payments", {
    headers: { Authorization: `Bearer ${premiumRoleUser.accessToken}` }
  });
  if (!Array.isArray(legacyPayments)) {
    throw new Error("Expected me/payments without page to stay array-compatible");
  }
  const pagedPayments = await request("/me/payments?page=1&pageSize=2", {
    headers: { Authorization: `Bearer ${premiumRoleUser.accessToken}` }
  });
  if (!pagedPayments.pagination || pagedPayments.pagination.pageSize !== 2 || !Array.isArray(pagedPayments.hits)) {
    throw new Error("Expected paginated me/payments response when page is requested");
  }
  const disabledAgainSettings = await request("/admin/settings", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({ monetizationEnabled: false })
  });
  if (disabledAgainSettings.monetizationEnabled !== false) {
    throw new Error("Expected owner to disable monetization after payment smoke");
  }

  console.log(`Smoke OK: ${API_BASE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
