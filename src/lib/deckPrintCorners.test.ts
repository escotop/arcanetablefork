import { describe, expect, it } from 'vitest';
import {
  fillWhiteCornersBlack,
  PRINT_CORNER_RADIUS_RATIO,
  PRINT_WHITE_CORNER_MIN,
} from './deckPrintLayout';
import {
  DIABOLIC_REVELATION_CORNERS,
  DIABOLIC_REVELATION_CORNER_SIZE as S,
  DIABOLIC_REVELATION_SIZE,
} from './deckPrintCorners.fixture';

const BORDER = 16;

/** Card-sized RGBA image of plain black border with the real corners pasted in. */
function diabolicRevelation(corners = DIABOLIC_REVELATION_CORNERS) {
  const { width, height } = DIABOLIC_REVELATION_SIZE;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = BORDER;
    data[i + 3] = 255;
  }
  const origins = { tl: [0, 0], tr: [width - S, 0], bl: [0, height - S], br: [width - S, height - S] };
  for (const [name, [x0, y0]] of Object.entries(origins)) {
    const rgb = Buffer.from(corners[name as keyof typeof corners], 'base64');
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const src = (y * S + x) * 3;
        const dst = ((y0 + y) * width + x0 + x) * 4;
        data[dst] = rgb[src];
        data[dst + 1] = rgb[src + 1];
        data[dst + 2] = rgb[src + 2];
      }
    }
  }
  return { data, width, height };
}

const minAt = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4;
  return Math.min(data[i], data[i + 1], data[i + 2]);
};

/** Top-left corner pixels whose value changed. */
function changedTopLeft(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number) {
  const changed: [number, number][] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * width + x) * 4;
      if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) {
        changed.push([x, y]);
      }
    }
  }
  return changed;
}

describe('black corners for cards with white corners (Diabolic Revelation)', () => {
  it('finds the white area: about 163 px per corner, 20 px along each edge', () => {
    const { data, width } = diabolicRevelation();
    let white = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (minAt(data, width, x, y) >= PRINT_WHITE_CORNER_MIN) white++;
      }
    }
    expect(white).toBeGreaterThan(140);
    expect(white).toBeLessThan(180);
  });

  it('paints the white corners black and leaves no light pixels outside the card', () => {
    const { data, width, height } = diabolicRevelation();
    expect(fillWhiteCornersBlack(data, width, height)).toBe(true);
    const radius = Math.round(width * PRINT_CORNER_RADIUS_RATIO);
    const corners = [
      [0, 0, 1, 1],
      [width - 1, 0, -1, 1],
      [0, height - 1, 1, -1],
      [width - 1, height - 1, -1, -1],
    ];
    for (const [x0, y0, dx, dy] of corners) {
      for (let ly = 0; ly < radius; ly++) {
        for (let lx = 0; lx < radius; lx++) {
          // Outside the card's rounded edge (the card art itself is not checked).
          if (Math.hypot(radius - lx, radius - ly) < radius) continue;
          expect(minAt(data, width, x0 + dx * lx, y0 + dy * ly)).toBeLessThan(70);
        }
      }
    }
  });

  it('does not paint past the rounded corner', () => {
    const { data, width, height } = diabolicRevelation();
    const before = data.slice();
    fillWhiteCornersBlack(data, width, height);
    const radius = Math.round(width * PRINT_CORNER_RADIUS_RATIO);
    const changed = changedTopLeft(before, data, width);
    expect(changed.length).toBeGreaterThan(160);
    expect(changed.length).toBeLessThan(radius * radius * (1 - Math.PI / 4) + 2 * radius * 2);
    for (const [x, y] of changed) {
      expect(Math.hypot(radius - x, radius - y)).toBeGreaterThanOrEqual(radius - 2);
    }
    // The rest of the card is untouched.
    for (let y = S; y < height - S; y += 7) {
      for (let x = 0; x < width; x += 7) expect(minAt(data, width, x, y)).toBe(BORDER);
    }
  });

  it('leaves the card alone when fewer than 3 corners are white', () => {
    const blackCorner = Buffer.alloc(S * S * 3, BORDER).toString('base64');
    const { data, width, height } = diabolicRevelation({
      ...DIABOLIC_REVELATION_CORNERS,
      tr: blackCorner,
      br: blackCorner,
    });
    const before = data.slice();
    expect(fillWhiteCornersBlack(data, width, height)).toBe(false);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(before))).toBe(0);
  });

  it('on a white-bordered card only the area outside the curve turns black', () => {
    const width = 672;
    const height = 936;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    fillWhiteCornersBlack(data, width, height);
    const radius = Math.round(width * PRINT_CORNER_RADIUS_RATIO);
    expect(minAt(data, width, 0, 0)).toBe(0);
    // The white border right next to the corner and inside the curve stays white.
    expect(minAt(data, width, radius, 0)).toBe(255);
    expect(minAt(data, width, 0, radius)).toBe(255);
    expect(minAt(data, width, radius / 2, radius / 2)).toBe(255);
  });
});
