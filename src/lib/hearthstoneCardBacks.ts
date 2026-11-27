import type { MpcfillCardBackProduct } from './mpcfill/client';
import cardBacks from './hearthstoneCardBacks.json';

/** Card backs from the Hearthstone wiki; regenerate with scripts/fetch-hearthstone-cardbacks.mjs. */

export const HEARTHSTONE_CARD_BACKS_URL = 'https://hearthstone.wiki.gg/wiki/Card_back';
const IMAGE_BASE = 'https://hearthstone.wiki.gg/images';
const PREVIEW_WIDTH = 200;
export const HEARTHSTONE_PAGE_SIZE = 40;

type HearthstoneCardBack = {
  id: number;
  name: string;
  nameEs?: string;
  category: string;
  /** Sharper copy of the same back, when one was found. */
  hqUrl?: string;
};

function toProduct(back: HearthstoneCardBack): MpcfillCardBackProduct {
  const file = `CardBack${back.id}.png`;
  return {
    id: `hearthstone-${back.id}`,
    title: back.nameEs ?? back.name,
    imageUrl: back.hqUrl ?? `${IMAGE_BASE}/${file}`,
    previewUrl: `${IMAGE_BASE}/thumb/${file}/${PREVIEW_WIDTH}px-${file}`,
    sourceName: `Hearthstone · ${back.category}${back.hqUrl ? ' · HD' : ''}`,
  };
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** One page of card backs matching the query (Spanish or English name, or category). */
export function searchHearthstoneCardBacks(query: string, page: number) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = (cardBacks as HearthstoneCardBack[]).filter(back => {
    const haystack = normalize(`${back.nameEs ?? ''} ${back.name} ${back.category}`);
    return terms.every(term => haystack.includes(term));
  });
  const lastPage = Math.max(1, Math.ceil(matches.length / HEARTHSTONE_PAGE_SIZE));
  const start = (page - 1) * HEARTHSTONE_PAGE_SIZE;
  return {
    products: matches.slice(start, start + HEARTHSTONE_PAGE_SIZE).map(toProduct),
    hasNext: page < lastPage,
    lastPage,
  };
}
