import ColorHash from 'color-hash';
import { players, provider } from './globals';
import type { PlayArea } from './playArea';

const playerFallbackHash = new ColorHash({ lightness: 0.5, saturation: 0.95 });

export type PlayerColorEntry = {
  name?: string;
  color?: string;
};

export function resolvePlayerColor(entry?: PlayerColorEntry) {
  if (entry?.color) return entry.color;
  return playerFallbackHash.hex(entry?.name || 'Player');
}

function parseHex(hex: string) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return null;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      default:
        h = ((rn - gn) / d + 4) / 6;
    }
  }

  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number) {
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toByte = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/** Boost saturation/lightness for borders and name tags. */
export function vividPlayerColor(color: string) {
  const rgb = parseHex(color);
  if (!rgb) return color;

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return hslToHex(h, Math.min(1, s * 1.25 + 0.18), Math.min(0.62, Math.max(0.4, l * 1.12 + 0.06)));
}

export function displayPlayerColor(entry?: PlayerColorEntry) {
  return vividPlayerColor(resolvePlayerColor(entry));
}

export function textColorOnBackground(background: string) {  const hex = background.replace('#', '');
  if (hex.length !== 6) return '#fff';

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000' : '#fff';
}

export function getPlayAreaPlayerColor(playArea: PlayArea) {
  for (const player of players()) {
    if (playArea.playerSessionId && player.entry.playerSessionId === playArea.playerSessionId) {
      return displayPlayerColor(player.entry);
    }
    if (player.id === playArea.clientId) {
      return displayPlayerColor(player.entry);
    }
  }
  return vividPlayerColor(playerFallbackHash.hex('Player'));
}
export function syncLocalPlayerColor(color: string) {
  provider?.awareness?.setLocalStateField('color', color);
}
