import type {
  MtgplaymatsProduct,
  MtgplaymatsProductsResponse,
  MtgplaymatsSearchResponse,
} from './types';

const API_BASE = '/api/mtgplaymats';

export const MTGPLAYMATS_PAGE_SIZE = 24;

export const MTGPLAYMATS_COLLECTION_HANDLE = 'all';

export const MTGPLAYMATS_COLLECTION_URL =
  'https://mtgplaymats.com/es/collections/all';

function productUrl(handle: string) {
  return `https://mtgplaymats.com/es/products/${handle}`;
}

export function shopifyPlaymatImageUrl(src: string, width = 480) {
  const separator = src.includes('?') ? '&' : '?';
  return `${src}${separator}width=${width}`;
}

function mapMtgplaymatsProducts(data: MtgplaymatsProductsResponse): MtgplaymatsProduct[] {
  return (data.products ?? [])
    .map(product => {
      const imageUrl = product.images?.[0]?.src;
      if (!imageUrl) return undefined;
      return {
        id: product.id,
        title: product.title,
        handle: product.handle,
        imageUrl,
        productUrl: productUrl(product.handle),
      } satisfies MtgplaymatsProduct;
    })
    .filter((entry): entry is MtgplaymatsProduct => !!entry);
}

export async function fetchMtgplaymatsProducts(
  page: number,
  options: { collection?: string; limit?: number } = {},
): Promise<MtgplaymatsProduct[]> {
  const params = new URLSearchParams({
    collection: options.collection ?? MTGPLAYMATS_COLLECTION_HANDLE,
    page: String(Math.max(1, page)),
    limit: String(options.limit ?? MTGPLAYMATS_PAGE_SIZE),
  });

  const response = await fetch(`${API_BASE}/products?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Playmats catalog failed (${response.status})`);
  }

  const data = (await response.json()) as MtgplaymatsProductsResponse;
  return mapMtgplaymatsProducts(data);
}

export type MtgplaymatsSearchResult = {
  products: MtgplaymatsProduct[];
  total: number;
  hasNext: boolean;
  lastPage: number;
};

export async function searchMtgplaymatsProducts(
  query: string,
  page: number,
  options: { collection?: string; limit?: number } = {},
): Promise<MtgplaymatsSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { products: [], total: 0, hasNext: false, lastPage: 1 };
  }

  const params = new URLSearchParams({
    collection: options.collection ?? MTGPLAYMATS_COLLECTION_HANDLE,
    q: trimmed,
    page: String(Math.max(1, page)),
    limit: String(options.limit ?? MTGPLAYMATS_PAGE_SIZE),
  });

  const response = await fetch(`${API_BASE}/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Playmats search failed (${response.status})`);
  }

  const data = (await response.json()) as MtgplaymatsSearchResponse;
  return {
    products: mapMtgplaymatsProducts(data),
    total: data.total ?? 0,
    hasNext: data.hasNext ?? false,
    lastPage: data.lastPage ?? 1,
  };
}
