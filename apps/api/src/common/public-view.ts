// Serialization layer for PUBLIC (unauthenticated-readable) endpoints.
// Whitelists output fields so raw ORM rows never leak internal/sensitive data
// (moderationStatus, reports, role, privacySettings, timezone, internal ids,
// email, passwordHash, ...). Owner/admin endpoints keep their fuller shapes.

const STAFF_ROLES = new Set(["OWNER", "ADMIN", "MODERATOR"]);

function relationNames(value: any, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : item?.[key]?.name ?? item?.name))
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Minimal public author card used inside listings and chat messages.
// Keeps the opaque user id (needed by block / report / own-content client flows)
// but drops role, isPremium, status, timezone, email and profile internal ids.
export function toPublicAuthor(author: any) {
  const profile = author?.profile ?? {};
  return {
    id: author?.id ?? null,
    username: profile.username ?? author?.authorUsername ?? null,
    displayName: profile.displayName ?? author?.authorDisplayName ?? null,
    avatarUrl: profile.avatarUrl ?? author?.authorAvatarUrl ?? null,
    bio: profile.bio ?? null
  };
}

// Whitelisted, author-authored listing meta (no internal ids). Detail-only.
function toPublicMeta(meta: any) {
  if (!meta || typeof meta !== "object") return null;
  const { id, listingId, ...rest } = meta;
  return rest;
}

export type PublicListingOptions = { includeMeta?: boolean };

export function toPublicListing(listing: any, options: PublicListingOptions = {}) {
  if (!listing || typeof listing !== "object") return listing;
  const author = listing.author
    ? toPublicAuthor(listing.author)
    : {
        username: listing.authorUsername ?? null,
        displayName: listing.authorDisplayName ?? null,
        avatarUrl: listing.authorAvatarUrl ?? null,
        bio: null
      };
  const view: Record<string, unknown> = {
    id: listing.id,
    type: listing.type ?? null,
    title: listing.title ?? null,
    slug: listing.slug ?? null,
    body: listing.body ?? null,
    ageRating: listing.ageRating ?? null,
    fandomMode: listing.fandomMode ?? null,
    publishedAt: listing.publishedAt ?? null,
    tags: relationNames(listing.tags, "tag"),
    genres: relationNames(listing.genres, "genre"),
    fandoms: relationNames(listing.fandoms, "fandom"),
    characters: relationNames(listing.characters, "character"),
    likes: count(listing.likes),
    responses: count(listing.responses ?? listing._count?.responses),
    author
  };
  if (options.includeMeta) view.meta = toPublicMeta(listing.meta);
  // Documented viewer-state (only present when a Bearer token was supplied).
  if ("likedByMe" in listing) view.likedByMe = Boolean(listing.likedByMe);
  return view;
}

// Serializes either the legacy array shape or the { source, hits, pagination } shape.
export function serializeListingResult(result: any, options: PublicListingOptions = {}) {
  if (Array.isArray(result)) return result.map((item) => toPublicListing(item, options));
  if (result && Array.isArray(result.hits)) {
    return { ...result, hits: result.hits.map((item: any) => toPublicListing(item, options)) };
  }
  return result;
}

function reactionCounts(reactions: any): Record<string, number> {
  if (!Array.isArray(reactions)) {
    return reactions && typeof reactions === "object" ? reactions : {};
  }
  const counts: Record<string, number> = {};
  for (const reaction of reactions) {
    if (!reaction?.emoji) continue;
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
  }
  return counts;
}

export function toPublicChatMessage(message: any) {
  if (!message || typeof message !== "object") return message;
  const sender = message.sender ?? {};
  const profile = sender.profile ?? {};
  const view: Record<string, unknown> = {
    id: message.id,
    room: message.room ?? "general",
    text: message.text ?? null,
    createdAt: message.createdAt ?? null,
    author: {
      id: sender.id ?? null,
      username: profile.username ?? null,
      displayName: profile.displayName ?? null,
      avatarUrl: profile.avatarUrl ?? null
    },
    staff: STAFF_ROLES.has(sender.role),
    quote: message.quotesAsMessage?.[0]?.quotedTextSnapshot ?? null,
    drawingUrl: message.drawings?.[0]?.imageUrl ?? null,
    reactions: reactionCounts(message.reactions),
    likes: count(message.likes)
  };
  if ("likedByMe" in message) view.likedByMe = Boolean(message.likedByMe);
  if ("reactedByMe" in message) view.reactedByMe = message.reactedByMe ?? {};
  return view;
}

// Public author profile page. Keeps public-facing fields and the privacy-gated
// activity / Premium badge, but drops role, status, internal ids, raw
// privacySettings, timezone, email, timestamps.
export function toPublicProfile(profile: any) {
  if (!profile || typeof profile !== "object") return profile;
  const user = profile.user ?? {};
  return {
    username: profile.username ?? null,
    displayName: profile.displayName ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    coverImageUrl: profile.coverImageUrl ?? null,
    bio: profile.bio ?? null,
    writingStyle: profile.writingStyle ?? null,
    literacyLevel: profile.literacyLevel ?? null,
    preferredPostLength: profile.preferredPostLength ?? null,
    activityLevel: profile.activityLevel ?? null,
    favoriteGenres: profile.favoriteGenres ?? [],
    favoriteFandoms: profile.favoriteFandoms ?? [],
    favoriteCharacters: profile.favoriteCharacters ?? [],
    communicationPreferences: profile.communicationPreferences ?? null,
    socialLinks: profile.socialLinks ?? {},
    stats: profile.stats
      ? {
          listings: count(profile.stats.listings),
          likes: count(profile.stats.likes),
          responses: count(profile.stats.responses),
          memberSince: profile.stats.memberSince ?? null
        }
      : null,
    listingsPagination: profile.listingsPagination ?? null,
    privacy: profile.privacy ?? null,
    user: {
      id: user.id ?? null,
      isPremium: Boolean(user.isPremium),
      lastSeenAt: user.lastSeenAt ?? null,
      canMessage: user.canMessage !== false,
      listings: Array.isArray(user.listings) ? user.listings.map((item: any) => toPublicListing(item)) : []
    }
  };
}

export function toPublicCatalogItem(item: any) {
  if (!item || typeof item !== "object") return item;
  const view: Record<string, unknown> = {
    id: item.id,
    slug: item.slug ?? null,
    name: item.name ?? null,
    description: item.description ?? null
  };
  if (item.fandom) {
    view.fandom = { slug: item.fandom.slug ?? null, name: item.fandom.name ?? null };
  }
  return view;
}

export function toPublicPlan(plan: any) {
  if (!plan || typeof plan !== "object") return plan;
  return {
    code: plan.code ?? null,
    name: plan.name ?? null,
    description: plan.description ?? null,
    priceCents: count(plan.priceCents),
    currency: plan.currency ?? "RUB",
    durationDays: count(plan.durationDays),
    features: plan.features ?? {}
  };
}

export function toPublicAd(ad: any) {
  if (!ad || typeof ad !== "object") return ad;
  return {
    id: ad.id,
    position: ad.position ?? null,
    imageUrl: ad.imageUrl ?? null,
    clickUrl: ad.clickUrl ?? null,
    htmlCode: ad.htmlCode ?? null
  };
}

export function toPublicSeoPage(page: any) {
  if (!page || typeof page !== "object") return page;
  return {
    path: page.path ?? null,
    title: page.title ?? null,
    description: page.description ?? null,
    h1: page.h1 ?? null,
    canonical: page.canonical ?? null,
    ogTitle: page.ogTitle ?? null,
    ogDescription: page.ogDescription ?? null,
    ogImage: page.ogImage ?? null,
    indexable: page.indexable !== false,
    seoText: page.seoText ?? null,
    breadcrumbs: page.breadcrumbs ?? []
  };
}
