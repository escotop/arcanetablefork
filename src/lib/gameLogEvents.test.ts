import { expect, test } from 'vitest';
import { MeshStandardMaterial } from 'three';
import { serializeCardUserDataForLog } from './gameLogEvents';

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
