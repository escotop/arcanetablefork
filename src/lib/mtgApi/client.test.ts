import { expect, test } from 'vitest';

test('MTG API client module loads', async () => {
  const mod = await import('./client');
  expect(mod.searchMtgApiCards).toBeTypeOf('function');
});
