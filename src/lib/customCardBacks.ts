import { createSignal } from 'solid-js';
import { buildPublicImageProxyUrl } from './customCardArt';
import { hashString } from './deckSyncMapping';
import type { MpcfillCardBackProduct } from './mpcfill/client';

/**
 * Card backs added by URL. They live in this browser's storage; signed-in users also save
 * them to their account as favorites, so they show up on other devices.
 */

export const CUSTOM_CARD_BACK_PREFIX = 'custom-';
export const CUSTOM_CARD_BACK_SOURCE = 'Custom';
const STORAGE_KEY = 'mtgplayer-custom-card-backs';

export function isCustomCardBackId(id: string | number | undefined) {
  return String(id ?? '').startsWith(CUSTOM_CARD_BACK_PREFIX);
}

/**
 * URL to load a card back image in the browser. Catalog images go through our proxy,
 * which only allows known hosts; custom ones can come from any site, so they use weserv.
 */
export function cardBackImageUrl(url: string, id?: string) {
  if (isCustomCardBackId(id)) return buildPublicImageProxyUrl(url) ?? url;
  return `/image-proxy?uri=${encodeURIComponent(url)}`;
}

/** The URL as an http(s) image address, or undefined if it isn't one. */
export function parseCardBackUrl(input: string): string | undefined {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function titleFromUrl(url: string) {
  try {
    const file = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    const name = file
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    return name || 'Reverso custom';
  } catch {
    return 'Reverso custom';
  }
}

export function createCustomCardBack(url: string, title?: string): MpcfillCardBackProduct {
  return {
    id: `${CUSTOM_CARD_BACK_PREFIX}${hashString(url)}`,
    title: title?.trim() || titleFromUrl(url),
    imageUrl: url,
    previewUrl: url,
    sourceName: CUSTOM_CARD_BACK_SOURCE,
  };
}

function readStored(): MpcfillCardBackProduct[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(item => isCustomCardBackId(item?.id) && typeof item.imageUrl === 'string')
      : [];
  } catch {
    return [];
  }
}

const [customCardBacks, setCustomCardBacks] = createSignal(readStored());
/** Custom card backs saved in this browser, newest first (reactive). */
export { customCardBacks };

function store(list: MpcfillCardBackProduct[]) {
  setCustomCardBacks(list);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: they stay for this session only.
  }
}

export function addCustomCardBack(back: MpcfillCardBackProduct) {
  store([back, ...customCardBacks().filter(item => item.id !== back.id)]);
}

export function removeCustomCardBack(id: string) {
  store(customCardBacks().filter(item => item.id !== id));
}
