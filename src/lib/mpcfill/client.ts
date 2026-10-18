import type { MpcfillExploreCard, MpcfillExploreResponse } from './types';

const API_BASE = '/api/mpcfill';

export const MPCFILL_EXPLORE_PAGE_SIZE = 24;

export const MPCFILL_EXPLORE_URL = 'https://mpcfill.com/explore';

export function mpcfillCardBackImageUrl(url: string) {
  return `/image-proxy?uri=${encodeURIComponent(url)}`;
}

export type MpcfillCardBackProduct = {
  id: string;
  title: string;
  previewUrl: string;
  imageUrl: string;
  sourceName?: string;
};

function mapExploreCard(card: MpcfillExploreCard): MpcfillCardBackProduct | undefined {
  const imageUrl = card.downloadLink ?? card.mediumThumbnailUrl ?? card.smallThumbnailUrl;
  const previewUrl = card.smallThumbnailUrl ?? card.mediumThumbnailUrl ?? imageUrl;
  if (!imageUrl || !previewUrl) return undefined;
  return {
    id: card.identifier,
    title: card.name,
    previewUrl,
    imageUrl,
    sourceName: card.sourceName,
  };
}

export async function exploreMpcfillCardbacks(
  query: string,
  page: number,
  options: { limit?: number } = {},
): Promise<{
  products: MpcfillCardBackProduct[];
  total: number;
  hasNext: boolean;
  lastPage: number;
}> {
  const params = new URLSearchParams({
    q: query.trim(),
    page: String(Math.max(1, page)),
    limit: String(options.limit ?? MPCFILL_EXPLORE_PAGE_SIZE),
  });

  const response = await fetch(`${API_BASE}/explore?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`MPC Autofill explore failed (${response.status})`);
  }

  const data = (await response.json()) as MpcfillExploreResponse;
  return {
    products: (data.cards ?? [])
      .map(mapExploreCard)
      .filter((entry): entry is MpcfillCardBackProduct => !!entry),
    total: data.total ?? 0,
    hasNext: data.hasNext ?? false,
    lastPage: data.lastPage ?? 1,
  };
}
