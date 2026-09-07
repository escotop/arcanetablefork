import { expect, test } from 'vitest';
import * as encoding from 'lib0/encoding';
import { MeshStandardMaterial } from 'three';
import {
  sanitizeGameLogEvent,
  serializeCardUserDataForLog,
  slimCardDetailForLog,
} from './gameLogEvents';

test('serializeCardUserDataForLog strips Three.js materials', () => {
  const userData = {
    id: 'card-1',
    isDoubleSided: true,
    isPublic: true,
    isFlipped: false,
    cardBack: new MeshStandardMaterial(),
    publicCardBack: new MeshStandardMaterial(),
    card: { detail: { name: 'Test', card_faces: [{}, {}] } },
  };

  const serialized = serializeCardUserDataForLog(userData);

  expect(serialized.id).toBe('card-1');
  expect(serialized.isDoubleSided).toBe(true);
  expect(serialized.isPublic).toBe(true);
  expect(serialized.cardBack).toBeUndefined();
  expect(serialized.publicCardBack).toBeUndefined();
  expect(() => JSON.stringify(serialized)).not.toThrow();
});

test('slimCardDetailForLog removes bulky Scryfall fields', () => {
  const slim = slimCardDetailForLog({
    name: 'Soldier',
    image_uris: { normal: 'front.webp', art_crop: 'art.webp' },
    legalities: { commander: 'legal' },
    all_parts: [{ name: 'Parent', component: 'combo_piece', uri: 'x' }],
    prices: { usd: '1.00' },
  });

  expect(slim?.name).toBe('Soldier');
  expect(slim?.image_uris).toEqual({ normal: 'front.webp', art_crop: 'art.webp' });
  expect(slim?.legalities).toBeUndefined();
  expect(slim?.all_parts).toBeUndefined();
  expect(slim?.prices).toBeUndefined();
});

test('sanitizeGameLogEvent keeps toggleTokenMenu encodable by Yjs', () => {
  const nested = { name: 'Face', image_uris: { normal: 'face.webp' } };
  let deep: Record<string, unknown> = nested;
  for (let i = 0; i < 40; i++) {
    deep = { name: `Level ${i}`, card_faces: [deep] };
  }

  const event = sanitizeGameLogEvent({
    type: 'toggleTokenMenu',
    payload: {
      availableTokens: [{ ...deep, clientId: 1 }],
      ids: ['token-1'],
    },
  });

  const encoder = encoding.createEncoder();
  expect(() => encoding.writeAny(encoder, event)).not.toThrow();
});

test('sanitizeGameLogEvent keeps createCard encodable by Yjs', () => {
  const event = sanitizeGameLogEvent({
    type: 'createCard',
    payload: {
      zoneId: 'battlefield-1',
      userData: {
        id: 'token-copy-1',
        isToken: true,
        card: {
          detail: {
            name: 'Clue',
            image_uris: { normal: 'clue.webp' },
            legalities: { commander: 'legal' },
          },
        },
        card_face_urls: ['clue.webp'],
      },
    },
  });

  const encoder = encoding.createEncoder();
  expect(() => encoding.writeAny(encoder, event)).not.toThrow();
  expect(
    (event.payload as { userData: { card_face_urls?: unknown } }).userData.card_face_urls,
  ).toBeUndefined();
});
