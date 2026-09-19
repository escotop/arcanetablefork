import {
  CardEntryDetail,
  Deck as StoredDeck,
  DetailedCardEntry,
} from './constants';
import { getTextureLoadUrl, normalizeTextureUrl } from './customCardArt';
import { isCommanderCard } from './deckCommander';
import {
  normalizePrintingCollectorNumber,
  normalizePrintingSetCode,
} from './deckPrinting';
import { DEFAULT_CARD_BACK_URL } from './mtgCardSystem';
import {
  getCardById,
  getCardBySetCollector,
  getCardNamed,
} from './scryfall/client';

export const DEFAULT_DECK_PREVIEW = DEFAULT_CARD_BACK_URL;

const previewDirectUrlCache = new Map<string, string>();

function isApiScryfallImageUrl(url: string | undefined) {
  if (!url) return false;
  try {
    return new URL(url, 'https://example.com').hostname === 'api.scryfall.com';
  } catch {
    return false;
  }
}

export function isBrokenDeckCoverUrl(url: string | undefined) {
  return isBrokenStoredCover(url);
}

const SCRYFALL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ImageUrisLike = CardEntryDetail['image_uris'] & {
  art?: Record<string, string>;
  full?: Record<string, string>;
  art_crop?: string;
  normal?: string;
  large?: string;
};

export function isScryfallCardUuid(id: string | undefined): id is string {
  return !!id && SCRYFALL_UUID_RE.test(id);
}

/** Parses deck entry ids like `Sol Ring:mh1:242` when set/cn are not stored separately. */
export function parseCompositeDeckEntryId(id: string | undefined) {
  if (!id || isScryfallCardUuid(id)) {
    return {} as { name?: string; set?: string; collector_number?: string };
  }

  const segments = id.split(':');
  if (segments.length >= 3) {
    const collector_number = segments.pop()!.trim();
    const set = segments.pop()!.trim();
    const name = segments.join(':').trim();
    return { name, set, collector_number };
  }
  if (segments.length === 2) {
    return { name: segments[0].trim(), set: segments[1].trim() };
  }
  return { name: id.trim() };
}

function normalizeDeckEntry(key: string, card: DetailedCardEntry): DetailedCardEntry {
  const existingName = (card.name ?? card.detail?.name)?.trim();
  if (existingName) return card;

  const fromId = parseCompositeDeckEntryId(card.id);
  if (fromId.name) {
    return {
      ...card,
      name: fromId.name,
      set: card.set || fromId.set || '',
      collector_number: card.collector_number ?? fromId.collector_number,
    };
  }

  const fromKey = key.includes(':') ? key.split(':')[0]! : key;
  return { ...card, name: fromKey.trim() || key };
}

/** Deck entries use composite keys (name:set:cn); Scryfall URLs need UUID or set/cn from detail. */
export function resolvePrintingForPreview(card: DetailedCardEntry) {
  const detail = card.detail;
  const fromComposite = parseCompositeDeckEntryId(
    card.id && !isScryfallCardUuid(card.id) ? card.id : undefined,
  );

  const scryfallId =
    (detail?.id && isScryfallCardUuid(detail.id) ? detail.id : undefined) ??
    (isScryfallCardUuid(card.id) ? card.id : undefined);

  const set = normalizePrintingSetCode(
    card.set || detail?.set || fromComposite.set,
  );
  const collector_number = normalizePrintingCollectorNumber(
    card.collector_number ?? detail?.collector_number ?? fromComposite.collector_number,
  );
  const name = (card.name ?? detail?.name ?? fromComposite.name)?.trim();

  return { scryfallId, set, collector_number, name };
}

export function scryfallCardImageUrl(
  card: DetailedCardEntry,
  version: 'normal' | 'art_crop' = 'normal',
) {
  const { scryfallId, set, collector_number, name } = resolvePrintingForPreview(card);

  if (scryfallId) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(scryfallId)}?format=image&version=${version}`;
  }
  if (set && collector_number) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(String(collector_number))}?format=image&version=${version}`;
  }
  if (name) {
    return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=${version}`;
  }
  return undefined;
}

function previewImageFromDetail(detail: CardEntryDetail | undefined): string | undefined {
  if (!detail) return undefined;

  const uris = detail.image_uris as ImageUrisLike | undefined;
  if (uris) {
    const direct =
      normalizeTextureUrl(uris.art_crop) ??
      normalizeTextureUrl(uris.normal) ??
      normalizeTextureUrl(uris.large);
    if (direct) return direct;

    const legacyArt = uris.art ? Object.values(uris.art)[0] : undefined;
    const legacyFull = uris.full ? Object.values(uris.full)[0] : undefined;
    const legacy =
      normalizeTextureUrl(legacyArt) ?? normalizeTextureUrl(legacyFull);
    if (legacy) return legacy;
  }

  const face = detail.card_faces?.[0];
  if (face?.image_uris) {
    const faceUris = face.image_uris as ImageUrisLike;
    return (
      normalizeTextureUrl(faceUris.art_crop) ??
      normalizeTextureUrl(faceUris.normal) ??
      normalizeTextureUrl(faceUris.large) ??
      normalizeTextureUrl(faceUris.art ? Object.values(faceUris.art)[0] : undefined)
    );
  }

  return undefined;
}

function cardPopularity(card: DetailedCardEntry) {
  return (
    card.detail?.popularity ??
    (card as DetailedCardEntry & { popularity?: number }).popularity ??
    99999
  );
}

function collectDeckEntries(deck: StoredDeck) {
  const pool: DetailedCardEntry[] = [];

  const pushSection = (section: Record<string, DetailedCardEntry> | undefined) => {
    for (const [key, card] of Object.entries(section ?? {})) {
      if ((card.qty ?? 0) > 0) {
        pool.push(normalizeDeckEntry(key, card));
      }
    }
  };

  pushSection(deck.inPlay);
  pushSection(deck.cards);

  return pool;
}

export function getDeckCoverCard(deck: StoredDeck): DetailedCardEntry | undefined {
  const pool = collectDeckEntries(deck);

  const commanders = pool.filter(isCommanderCard);
  if (commanders.length) {
    return [...commanders].sort((left, right) => cardPopularity(left) - cardPopularity(right))[0];
  }

  let best: DetailedCardEntry | undefined;
  for (const card of pool) {
    if (!best || cardPopularity(card) < cardPopularity(best)) {
      best = card;
    }
  }

  return best ?? pool[0];
}

function cardHasFullArt(detail: CardEntryDetail | undefined) {
  if (!detail) return false;

  const candidates = [detail, ...(detail.card_faces ?? [])];
  return candidates.some(face => {
    const extended = face as CardEntryDetail & {
      full_art?: boolean;
      frame_effects?: string[];
      illustration_type?: string;
    };
    if (extended.full_art) return true;
    if (extended.illustration_type === 'full_art') return true;
    return (
      extended.frame_effects?.some(
        effect => effect === 'extendedart' || effect === 'fullart' || effect === 'showcase',
      ) ?? false
    );
  });
}

function withTextureProxy(url: string | undefined) {
  if (!url) return undefined;
  return getTextureLoadUrl(url) ?? url;
}

function isBrokenStoredCover(url: string | undefined) {
  if (!url) return true;
  if (url.includes('arcane-table-back.webp')) return true;

  try {
    const parsed = new URL(url, 'https://example.com');
    if (parsed.hostname === 'api.scryfall.com') {
      return true;
    }

    const match = parsed.pathname.match(/^\/cards\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return false;

    const first = decodeURIComponent(match[1] ?? '');
    const second = match[2];

    if (second) return false;
    if (isScryfallCardUuid(first)) return false;

    return first.includes(':') || first.length > 40;
  } catch {
    return false;
  }
}

function pushPreviewCandidate(target: string[], url: string | undefined) {
  if (!url || isApiScryfallImageUrl(url)) return;
  const resolved = withTextureProxy(url) ?? url;
  if (!target.includes(resolved)) target.push(resolved);
}

function directUrlFromScryfallDetail(detail: CardEntryDetail | undefined) {
  const fromPreview = previewImageFromDetail(detail);
  if (fromPreview && !isApiScryfallImageUrl(fromPreview)) return fromPreview;

  const uris = detail?.image_uris as ImageUrisLike | undefined;
  const direct =
    uris?.art_crop ?? uris?.normal ?? uris?.large;
  if (direct && !isApiScryfallImageUrl(direct)) {
    return normalizeTextureUrl(direct) ?? direct;
  }

  const face = detail?.card_faces?.[0]?.image_uris as ImageUrisLike | undefined;
  const faceDirect = face?.art_crop ?? face?.normal ?? face?.large;
  if (faceDirect && !isApiScryfallImageUrl(faceDirect)) {
    return normalizeTextureUrl(faceDirect) ?? faceDirect;
  }

  return undefined;
}

async function fetchCoverCardDetail(card: DetailedCardEntry) {
  const { scryfallId, set, collector_number, name } = resolvePrintingForPreview(card);

  if (scryfallId) {
    return getCardById(scryfallId);
  }
  if (set && collector_number) {
    return getCardBySetCollector(set, collector_number);
  }
  if (name) {
    return getCardNamed(name, { set: set || undefined });
  }
  return null;
}

/** Resolves a hotlinkable `cards.scryfall.io` (or custom) URL; never uses api.scryfall.com image redirects. */
export async function fetchDeckPreviewDirectUrl(deck: StoredDeck): Promise<string | undefined> {
  const cacheKey = deck.id;
  const cached = previewDirectUrlCache.get(cacheKey);
  if (cached) return cached;

  const card = getDeckCoverCard(deck);
  if (!card) return undefined;

  if (card.customArtUrl) {
    const custom = withTextureProxy(normalizeTextureUrl(card.customArtUrl) ?? card.customArtUrl);
    if (custom) previewDirectUrlCache.set(cacheKey, custom);
    return custom;
  }

  const fromEntry = directUrlFromScryfallDetail(card.detail);
  if (fromEntry) {
    const proxied = withTextureProxy(fromEntry) ?? fromEntry;
    previewDirectUrlCache.set(cacheKey, proxied);
    return proxied;
  }

  const detail = await fetchCoverCardDetail(card);
  const resolved = directUrlFromScryfallDetail(detail ?? undefined);
  if (!resolved) return undefined;

  const proxied = withTextureProxy(resolved) ?? resolved;
  previewDirectUrlCache.set(cacheKey, proxied);
  return proxied;
}

function getDeckCoverArtUrl(card: DetailedCardEntry): string | undefined {
  if (card.customArtUrl) {
    const custom = normalizeTextureUrl(card.customArtUrl) ?? card.customArtUrl;
    return withTextureProxy(custom);
  }

  const fromDetail = directUrlFromScryfallDetail(card.detail);
  if (fromDetail) return withTextureProxy(fromDetail);

  return undefined;
}

function recomputeCoverFromDeck(deck: StoredDeck) {
  const card = getDeckCoverCard(deck);
  if (!card) {
    return {};
  }

  const coverImage = getDeckCoverArtUrl(card);

  if (!coverImage) {
    return card.detail ? { coverImageFullArt: cardHasFullArt(card.detail) } : {};
  }

  return {
    coverImage,
    coverImageFullArt: card.detail ? cardHasFullArt(card.detail) : true,
  };
}

export function getDeckCoverMetadata(
  deck: StoredDeck,
): Pick<StoredDeck, 'coverImage' | 'coverImageFullArt'> {
  const stored = deck.coverImage;
  if (stored && !isBrokenStoredCover(stored)) {
    return {
      coverImage: stored,
      coverImageFullArt: deck.coverImageFullArt ?? true,
    };
  }

  return recomputeCoverFromDeck(deck);
}

/** Ordered fallbacks for preview `<img>` (stored cover first, like pre-refactor UI). */
export function getDeckPreviewImageUrlCandidates(deck: StoredDeck): string[] {
  const candidates: string[] = [];

  if (deck.coverImage && !isBrokenStoredCover(deck.coverImage)) {
    pushPreviewCandidate(candidates, deck.coverImage);
  }

  const card = getDeckCoverCard(deck);
  if (card) {
    if (card.customArtUrl) {
      pushPreviewCandidate(
        candidates,
        normalizeTextureUrl(card.customArtUrl) ?? card.customArtUrl,
      );
    }
    pushPreviewCandidate(candidates, directUrlFromScryfallDetail(card.detail));
  }

  pushPreviewCandidate(candidates, DEFAULT_DECK_PREVIEW);

  return candidates;
}

export function getDeckPreviewImageUrl(deck: StoredDeck) {
  return getDeckPreviewImageUrlCandidates(deck)[0] ?? DEFAULT_DECK_PREVIEW;
}

/** @deprecated use getDeckCoverCard */
export function getDeckPreviewCard(deck: StoredDeck): DetailedCardEntry | undefined {
  return getDeckCoverCard(deck);
}
