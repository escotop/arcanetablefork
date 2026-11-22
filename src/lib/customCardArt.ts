import { CardEntryDetail, DetailedCardEntry } from '~/lib/constants';

const CUSTOM_ART_STORAGE_KEY = 'arcanetable-custom-card-art-v1';
const MTG_CARD_BUILDER_AJAX = 'https://mtgcardbuilder.com/wp-admin/admin-ajax.php';

export interface CustomCardArtOption {
  id: string;
  imageUrl: string;
  thumbUrl: string;
  label: string;
  source: 'custom' | 'gallery';
  creator?: string;
  searchCardName?: string;
}

export interface CustomCardArtResponse {
  data: CustomCardArtOption[];
  page: number;
  total_pages: number;
  total_cards: number;
}

function readCustomArtStore(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(CUSTOM_ART_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCustomArtStore(store: Record<string, string[]>) {
  localStorage.setItem(CUSTOM_ART_STORAGE_KEY, JSON.stringify(store));
}

export function getSavedCustomArtUrls(cardName: string): string[] {
  return readCustomArtStore()[cardName] ?? [];
}

export function addSavedCustomArtUrl(cardName: string, url: string): string[] {
  const trimmed = url.trim();
  if (!trimmed) return getSavedCustomArtUrls(cardName);

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return getSavedCustomArtUrls(cardName);
    }
  } catch {
    return getSavedCustomArtUrls(cardName);
  }

  const store = readCustomArtStore();
  const existing = store[cardName] ?? [];
  const next = [trimmed, ...existing.filter(entry => entry !== trimmed)];
  store[cardName] = next;
  writeCustomArtStore(store);
  return next;
}

function normalizeGalleryName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getGallerySearchName(cardName: string): string {
  return cardName.split('//')[0]?.trim() || cardName.trim();
}

function getGalleryNameCandidates(cardName: string): string[] {
  const names = new Set<string>();
  const add = (value?: string) => {
    const normalized = normalizeGalleryName(value ?? '');
    if (normalized) names.add(normalized);
  };

  add(getGallerySearchName(cardName));
  for (const part of cardName.split('//')) {
    add(part);
  }

  return [...names];
}

export function galleryEntryMatchesCardName(
  cardName: string,
  searchCardName?: string | null,
): boolean {
  const normalizedSearchName = normalizeGalleryName(searchCardName ?? '');
  if (!normalizedSearchName) return false;

  return getGalleryNameCandidates(cardName).some(candidate => candidate === normalizedSearchName);
}

export function isTokenCardDetail(detail?: Partial<CardEntryDetail> | null): boolean {
  const layout = (detail as { layout?: string } | undefined)?.layout;
  if (layout === 'token' || layout === 'double_faced_token') return true;
  return /\btoken\b/i.test(detail?.type_line ?? '');
}

/**
 * Token customs are often uploaded without a card name ("null") and titled like
 * "Zesty Goblin Token_5"; accept those when the title has the token name and "token".
 */
export function galleryTokenEntryMatches(
  tokenName: string,
  searchCardName?: string | null,
  edition?: string | null,
): boolean {
  if (galleryEntryMatchesCardName(tokenName, searchCardName)) return true;
  const normalizedSearchName = normalizeGalleryName(searchCardName ?? '');
  if (normalizedSearchName && normalizedSearchName !== 'null') return false;

  const title = ` ${normalizeGalleryName(edition ?? '')} `;
  if (!title.includes(' token ')) return false;
  return getGalleryNameCandidates(tokenName).some(name => title.includes(` ${name} `));
}

export async function fetchGalleryCustomArt(
  cardName: string,
  page = 1,
  options: { token?: boolean } = {},
): Promise<CustomCardArtResponse> {
  const baseName = getGallerySearchName(cardName);
  const searchName =
    options.token && !/\btoken$/i.test(baseName) ? `${baseName} token` : baseName;
  const formData = new FormData();
  formData.append('action', 'builder_ajax');
  formData.append('method', 'search_gallery_cards');
  formData.append('search', searchName);
  formData.append('order', 'newest');
  formData.append('nsfw', '0');
  formData.append('other', '0');
  formData.append('cpage', String(page));

  try {
    const res = await fetch(MTG_CARD_BUILDER_AJAX, { method: 'POST', body: formData });
    if (!res.ok) {
      return { data: [], page: 1, total_pages: 0, total_cards: 0 };
    }

    const body = (await res.json()) as {
      data?: Array<{
        id?: string;
        card_edition?: string;
        search_card_name?: string;
        image_url?: string;
        thumb_url?: string;
        user_name?: string;
      }>;
      total?: number;
      current?: number;
    };

    return {
      data: (body.data ?? [])
        .filter(
          entry =>
            entry.image_url &&
            (options.token
              ? galleryTokenEntryMatches(cardName, entry.search_card_name, entry.card_edition)
              : galleryEntryMatchesCardName(cardName, entry.search_card_name)),
        )
        .map(entry => ({
          id: `gallery-${entry.id ?? entry.image_url}`,
          imageUrl: entry.image_url!,
          thumbUrl: entry.thumb_url || entry.image_url!,
          label: entry.card_edition || entry.search_card_name || baseName,
          source: 'gallery' as const,
          creator: entry.user_name,
          searchCardName: entry.search_card_name ?? undefined,
        })),
      page: body.current ?? page,
      total_pages: body.total ?? 0,
      total_cards: body.data?.length ?? 0,
    };
  } catch {
    return { data: [], page: 1, total_pages: 0, total_cards: 0 };
  }
}

export function buildCustomArtImageUris(
  cardName: string,
  imageUrl: string,
): CardEntryDetail['image_uris'] {
  const normalized = normalizeTextureUrl(imageUrl) ?? imageUrl;
  return {
    full: { [cardName]: normalized },
    art: { [cardName]: normalized },
  };
}

const TEXTURE_PROXY_HOST_SUFFIXES = ['wasabisys.com', 'mtgcardbuilder.com', 'wp.com'];

function isTextureProxyHost(hostname: string) {
  return TEXTURE_PROXY_HOST_SUFFIXES.some(
    suffix => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

export function needsTextureProxy(url: string): boolean {
  try {
    const base =
      typeof globalThis.location !== 'undefined' ? globalThis.location.origin : 'http://localhost';
    const parsed = new URL(url, base);
    if (parsed.pathname === '/image-proxy') return false;
    if (typeof globalThis.location !== 'undefined' && parsed.origin === globalThis.location.origin) {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return isTextureProxyHost(parsed.hostname) || parsed.hostname.endsWith('scryfall.io');
  } catch {
    return false;
  }
}

/** Cross-origin art that may block browser fetches (CORS) and needs weserv fallback. */
export function needsCrossOriginImageFallback(url: string): boolean {
  try {
    const base =
      typeof globalThis.location !== 'undefined' ? globalThis.location.origin : 'http://localhost';
    const parsed = new URL(url, base);
    if (parsed.pathname === '/image-proxy') return false;
    if (parsed.hostname.endsWith('scryfall.io')) return false;
    if (parsed.hostname === 'images.weserv.nl') return false;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (typeof globalThis.location !== 'undefined' && parsed.origin === globalThis.location.origin) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getTextureLoadUrl(url: string | undefined): string | undefined {
  const normalized = normalizeTextureUrl(url);
  if (!normalized) return undefined;
  if (!needsTextureProxy(normalized)) return normalized;

  const proxyPath = `/image-proxy?uri=${encodeURIComponent(normalized)}`;
  if (typeof globalThis.location !== 'undefined') {
    return new URL(proxyPath, globalThis.location.origin).href;
  }
  return proxyPath;
}

/** Normalized URL for `<img>` tags in deck editor and previews (direct load; no weserv). */
export function getCustomArtDisplayUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return normalizeTextureUrl(url) ?? url;
}

/** URL for `<img>` and UI previews (avoids CORS-blocked origins when possible). */
export function getDisplayTextureUrl(url: string | undefined): string | undefined {
  const normalized = normalizeTextureUrl(url);
  if (!normalized) return undefined;
  if (needsCrossOriginImageFallback(normalized)) {
    return (
      buildPublicImageProxyUrl(normalized, { width: CUSTOM_ART_PREVIEW_WIDTH }) ?? normalized
    );
  }
  return getTextureLoadUrl(normalized) ?? normalized;
}

/** Ordered fallbacks for fetching remote card art (proxy, direct, weserv). */
export function getTextureLoadUrlCandidates(
  url: string | undefined,
  options: { fullSize?: boolean } = {},
): string[] {
  const normalized = normalizeTextureUrl(url);
  if (!normalized) return [];

  const candidates: string[] = [];
  const push = (candidate: string | undefined) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };

  const crossOrigin = needsCrossOriginImageFallback(normalized);
  const weserv = buildPublicImageProxyUrl(normalized);

  if (crossOrigin) {
    // Resized first (fast); the full-size versions stay as fallbacks.
    // Printing asks for fullSize: it needs every pixel, not speed.
    if (!options.fullSize) {
      push(buildPublicImageProxyUrl(normalized, { width: CUSTOM_ART_TEXTURE_WIDTH }));
    }
    push(weserv);
  }

  push(getTextureLoadUrl(normalized));

  if (!crossOrigin) {
    push(normalized);
  }

  if (needsTextureProxy(normalized)) {
    push(weserv);
  }

  if (crossOrigin) {
    push(normalized);
  }

  return candidates;
}

/**
 * Width custom art is resized to by the proxy. Custom art is often a multi-MB PNG
 * (e.g. ~4.7 MB from mtgcardbuilder); resized to WebP it is ~150 KB and loads 10-20x faster.
 */
export const CUSTOM_ART_TEXTURE_WIDTH = 745;
export const CUSTOM_ART_PREVIEW_WIDTH = 1000;

export function buildPublicImageProxyUrl(
  url: string,
  resize?: { width: number },
): string | undefined {
  try {
    const parsed = new URL(url);
    const resource = `${parsed.host}${parsed.pathname}${parsed.search}`;
    const base = `https://images.weserv.nl/?url=${encodeURIComponent(resource)}`;
    if (!resize) return base;
    // withoutEnlargement keeps small images as they are; webp keeps transparency.
    return `${base}&w=${resize.width}&we&output=webp&q=88`;
  } catch {
    return undefined;
  }
}

export function isImageProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url, typeof globalThis.location !== 'undefined' ? globalThis.location.origin : 'http://localhost');
    return parsed.pathname === '/image-proxy';
  } catch {
    return false;
  }
}

export function normalizeTextureUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;

  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      const base =
        typeof globalThis.location !== 'undefined' ? globalThis.location.origin : 'http://localhost';
      parsed = new URL(url, base);
    }

    const innerUri = parsed.searchParams.get('uri');
    const isImageProxy =
      innerUri &&
      (parsed.pathname.endsWith('/card_images/') || parsed.pathname.endsWith('/card_art/'));

    if (isImageProxy && innerUri) {
      try {
        return new URL(innerUri).href;
      } catch {
        // fall through
      }
    }

    return parsed.href;
  } catch {
    return url;
  }
}

export function applyCustomArtToEntry(entry: DetailedCardEntry): DetailedCardEntry {
  if (!entry.customArtUrl) return entry;

  const imageUrl = normalizeTextureUrl(entry.customArtUrl) ?? entry.customArtUrl;
  const imageUris = buildCustomArtImageUris(entry.name, imageUrl);
  return {
    ...entry,
    customArtUrl: imageUrl,
    detail: {
      ...entry.detail,
      image_uris: imageUris,
      card_faces: entry.detail?.card_faces?.map((face, index) =>
        index === 0 ? { ...face, image_uris: imageUris } : face,
      ),
    },
  };
}

export function getCustomArtPreviewUrl(imageUrl: string) {
  return getCustomArtDisplayUrl(imageUrl) ?? imageUrl;
}

export function savedUrlsToCustomArtOptions(
  cardName: string,
  urls: string[],
): CustomCardArtOption[] {
  return urls.map((imageUrl, index) => ({
    id: `custom-${index}-${imageUrl}`,
    imageUrl,
    thumbUrl: imageUrl,
    label: 'Custom URL',
    source: 'custom' as const,
  }));
}

export function isCustomArtImageSelected(currentUrl: string | undefined, imageUrl: string) {
  if (!currentUrl) return false;
  const current = getCustomArtPreviewUrl(currentUrl);
  const candidate = getCustomArtPreviewUrl(imageUrl);
  return current === candidate || currentUrl === imageUrl;
}
