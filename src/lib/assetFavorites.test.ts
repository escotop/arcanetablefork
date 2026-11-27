import { createMemo, createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';

vi.mock('solid-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [{ ref: 'back-1', data: { id: 'back-1', title: 'Saved back' } }],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

test('favorites asked for before sign-in resolves load once the account is set', async () => {
  const { assetFavorites, setAssetFavoritesAccount } = await import('./assetFavorites');

  await createRoot(async dispose => {
    // The picker reads favorites while the account is still unknown.
    const titles = createMemo(() => assetFavorites('card_back').map(item => item.title));
    expect(titles()).toEqual([]);

    setAssetFavoritesAccount('user-1');
    await vi.waitFor(() => expect(titles()).toEqual(['Saved back']));
    dispose();
  });
});
