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

export async function fetchGalleryCustomArt(
  cardName: string,
  page = 1,
): Promise<CustomCardArtResponse> {
  const formData = new FormData();
  formData.append('action', 'builder_ajax');
  formData.append('method', 'search_gallery_cards');
  formData.append('search', cardName);
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
        .filter(entry => entry.image_url)
        .map(entry => ({
          id: `gallery-${entry.id ?? entry.image_url}`,
          imageUrl: entry.image_url!,
          thumbUrl: entry.thumb_url || entry.image_url!,
          label: entry.card_edition || cardName,
          source: 'gallery' as const,
          creator: entry.user_name,
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
    if (parsed.hostname.endsWith('scryfall.io')) return false;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return isTextureProxyHost(parsed.hostname);
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

export function buildPublicImageProxyUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const resource = `${parsed.host}${parsed.pathname}${parsed.search}`;
    return `https://images.weserv.nl/?url=${encodeURIComponent(resource)}`;
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

    if (isImageProxy) {
      const inner = new URL(innerUri);
      if (!inner.hostname.endsWith('scryfall.io')) {
        return inner.href;
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
  return imageUrl;
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
  return currentUrl === imageUrl || currentUrl === getCustomArtPreviewUrl(imageUrl);
}
