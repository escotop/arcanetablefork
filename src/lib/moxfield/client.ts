import type { CardEntryDetail } from '../constants';
import { getCardNamed } from '../scryfall/client';
import type {
  MoxfieldDeck,
  MoxfieldDeckListItem,
  MoxfieldDeckSummary,
  MoxfieldUserDecksResponse,
  MoxfieldUserSearchResponse,
} from './types';

const API_BASE = '/api/moxfield';
export const MOXFIELD_IMPORT_PAGE_SIZE = 30;
const previewCache = new Map<string, { commanderName?: string; commanderImageUrl?: string }>();

function isMoxfieldPayload(body: unknown): body is Record<string, unknown> {
  return !!body && typeof body === 'object' && !('error' in body && 'detail' in body);
}

async function fetchMoxfield<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
      throw new Error('Moxfield proxy misconfigured. Restart the dev server and try again.');
    }
    throw new Error(
      response.ok
        ? 'Moxfield returned an invalid response.'
        : 'Could not reach Moxfield. Try again in a moment.',
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      const errorCode =
        typeof body === 'object' && body && 'error' in body
          ? String((body as { error?: string }).error)
          : '';
      if (errorCode === 'not_found') {
        throw new Error('Moxfield proxy misconfigured. Restart the dev server and try again.');
      }
      throw new Error(
        'Could not load decks from Moxfield. Check the username or try again in a moment.',
      );
    }
    throw new Error(`Moxfield request failed (${response.status}).`);
  }

  if (!isMoxfieldPayload(body)) {
    throw new Error('Could not reach Moxfield. Try again in a moment.');
  }

  return body as T;
}

export function getMoxfieldCardImageUrl(card?: Record<string, unknown>): string | undefined {
  if (!card) return undefined;

  const scryfallId =
    (typeof card.scryfall_id === 'string' && card.scryfall_id) ||
    (typeof card.scryfallId === 'string' && card.scryfallId);

  if (scryfallId) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(scryfallId)}?format=image&version=art_crop`;
  }

  const set = typeof card.set === 'string' ? card.set : undefined;
  const collector =
    (typeof card.collector_number === 'string' && card.collector_number) ||
    (typeof card.collectorNumber === 'string' && card.collectorNumber);

  if (set && collector) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(collector)}?format=image&version=art_crop`;
  }

  return undefined;
}

function scryfallArtCropUrl(card: CardEntryDetail): string | undefined {
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  const faceUris = card.card_faces?.[0]?.image_uris;
  if (faceUris?.art_crop) return faceUris.art_crop;
  if (card.id) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(card.id)}?format=image&version=art_crop`;
  }
  return undefined;
}

function firstCommanderEntry(
  commanders?: MoxfieldDeckSummary['commanders'] | MoxfieldDeck['commanders'],
): { name?: string; imageUrl?: string } {
  if (!commanders) return {};

  const entries = Array.isArray(commanders) ? commanders : Object.values(commanders);
  const first = entries[0];
  const card = (first?.card ?? first) as Record<string, unknown> | undefined;

  return {
    name: typeof card?.name === 'string' ? card.name : undefined,
    imageUrl: getMoxfieldCardImageUrl(card),
  };
}

async function resolveCommanderPreview(
  publicId: string,
): Promise<{ commanderName?: string; commanderImageUrl?: string }> {
  const cached = previewCache.get(publicId);
  if (cached) return cached;

  let preview: { commanderName?: string; commanderImageUrl?: string } = {};

  try {
    const deck = await fetchMoxfieldDeck(publicId);
    const commander = firstCommanderEntry(deck.commanders);
    if (commander.imageUrl) {
      preview = {
        commanderName: commander.name,
        commanderImageUrl: commander.imageUrl,
      };
    } else if (commander.name) {
      const card = await getCardNamed(commander.name);
      preview = {
        commanderName: commander.name,
        commanderImageUrl: card ? scryfallArtCropUrl(card) : undefined,
      };
    }
  } catch {
    // Fall back to deck name-only preview for individual deck failures.
  }

  previewCache.set(publicId, preview);
  return preview;
}

export async function fetchCommanderPreview(publicId: string) {
  return resolveCommanderPreview(publicId);
}

export function deckListItemFromSummary(
  summary: MoxfieldDeckSummary,
  selected = true,
): MoxfieldDeckListItem {
  return {
    publicId: summary.publicId,
    name: summary.name?.trim() || 'Untitled deck',
    format: summary.format,
    selected,
  };
}

export interface FetchMoxfieldUserDecksPageOptions {
  signal?: AbortSignal;
  pageSize?: number;
}

export interface MoxfieldUserDecksPageResult {
  decks: MoxfieldDeckSummary[];
  pageNumber: number;
  totalPages: number;
  totalResults: number;
}

async function resolveMoxfieldUsername(username: string): Promise<string> {
  const trimmed = username.trim();
  if (!trimmed) {
    throw new Error('Enter a Moxfield username.');
  }

  const params = new URLSearchParams({
    filter: trimmed,
    pageNumber: '1',
    pageSize: '25',
  });

  const response = await fetchMoxfield<MoxfieldUserSearchResponse>(
    `/v2/users/search-sfw?${params.toString()}`,
  );

  const match = response.data?.find(
    user => user.userName?.toLowerCase() === trimmed.toLowerCase(),
  );

  if (!match?.userName) {
    throw new Error('User not found on Moxfield.');
  }

  return match.userName;
}

export { resolveMoxfieldUsername };

export async function fetchMoxfieldUserPublicDecksPage(
  resolvedUsername: string,
  pageNumber: number,
  options: FetchMoxfieldUserDecksPageOptions = {},
): Promise<MoxfieldUserDecksPageResult> {
  const pageSize = options.pageSize ?? MOXFIELD_IMPORT_PAGE_SIZE;

  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const params = new URLSearchParams({
    authorUserNames: resolvedUsername,
    pageNumber: String(pageNumber),
    pageSize: String(pageSize),
    sortType: 'Updated',
    sortDirection: 'Descending',
    filter: '',
    fmt: '',
    includePinned: 'true',
    showIllegal: 'true',
  });

  const response = await fetchMoxfield<MoxfieldUserDecksResponse>(
    `/v2/decks/search-sfw?${params.toString()}`,
  );

  if (pageNumber === 1 && (!response.data?.length || response.totalResults === 0)) {
    throw new Error('No public decks found for that user.');
  }

  return {
    decks: response.data ?? [],
    pageNumber,
    totalPages: response.totalPages ?? pageNumber,
    totalResults: response.totalResults ?? 0,
  };
}

/** @deprecated Use fetchMoxfieldUserPublicDecksPage for paginated loading. */
export async function fetchMoxfieldUserPublicDecks(
  username: string,
  options: { signal?: AbortSignal } = {},
): Promise<MoxfieldDeckSummary[]> {
  const resolvedUsername = await resolveMoxfieldUsername(username);
  const firstPage = await fetchMoxfieldUserPublicDecksPage(resolvedUsername, 1, options);
  return firstPage.decks;
}

/** @deprecated Prefer deckListItemFromSummary + fetchCommanderPreview on demand. */
export async function enrichDeckSummaries(
  summaries: MoxfieldDeckSummary[],
): Promise<
  Array<{
    publicId: string;
    name: string;
    format?: string;
    commanderName?: string;
    commanderImageUrl?: string;
  }>
> {
  return summaries.map(summary => deckListItemFromSummary(summary, true));
}

export function fetchMoxfieldDeck(publicId: string) {
  return fetchMoxfield<MoxfieldDeck>(`/v2/decks/all/${encodeURIComponent(publicId.trim())}`);
}
