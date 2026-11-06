import { Component, createEffect, createSignal, For, on } from 'solid-js';
import { toast } from 'solid-sonner';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { useAuth } from '~/lib/auth';
import { setCardFavoritesAccount } from '~/lib/cardFavorites';
import {
  dismissUploadPrompt,
  setDeckAccount,
  uploadCandidates,
  uploadLocalDecks,
} from '~/lib/deckSync';

/** Keeps deck storage pointed at the signed-in account and offers to upload local decks. */
export const DeckSyncBridge: Component = () => {
  const auth = useAuth();
  const [selected, setSelected] = createSignal<Set<string>>(new Set());

  createEffect(
    on(
      () => [auth.loading(), auth.user()?.id ?? null] as const,
      ([loading, uid]) => {
        if (loading) return;
        setDeckAccount(uid);
        setCardFavoritesAccount(uid);
      },
    ),
  );

  // Every deck is selected by default when the prompt opens.
  createEffect(
    on(uploadCandidates, candidates => {
      setSelected(new Set(candidates.map(candidate => candidate.deck.id)));
    }),
  );

  function toggle(id: string, checked: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onUpload() {
    const ids = [...selected()];
    uploadLocalDecks(ids);
    toast.success(`Uploading ${ids.length} deck${ids.length === 1 ? '' : 's'} to your account`);
  }

  const allSelected = () =>
    uploadCandidates().length > 0 && selected().size === uploadCandidates().length;

  return (
    <Dialog
      open={uploadCandidates().length > 0}
      onOpenChange={open => {
        if (!open) dismissUploadPrompt();
      }}>
      <DialogContent class='max-w-md'>
        <DialogHeader>
          <DialogTitle>Upload local decks?</DialogTitle>
          <DialogDescription>
            These decks are saved on this device but not in your account. Upload them to use them
            on any device. Local copies are kept.
          </DialogDescription>
        </DialogHeader>

        <label class='flex items-center gap-2 text-sm font-medium'>
          <input
            type='checkbox'
            class='size-4 accent-primary'
            checked={allSelected()}
            onChange={event =>
              setSelected(
                event.currentTarget.checked
                  ? new Set(uploadCandidates().map(candidate => candidate.deck.id))
                  : new Set<string>(),
              )
            }
          />
          Select all
        </label>

        <ul class='max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border'>
          <For each={uploadCandidates()}>
            {candidate => (
              <li>
                <label class='flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent'>
                  <input
                    type='checkbox'
                    class='size-4 shrink-0 accent-primary'
                    checked={selected().has(candidate.deck.id)}
                    onChange={event => toggle(candidate.deck.id, event.currentTarget.checked)}
                  />
                  <span class='min-w-0 flex-1 truncate text-sm'>
                    {candidate.deck.name || 'Untitled'}
                  </span>
                  <span class='shrink-0 text-xs text-muted-foreground'>
                    {candidate.cardCount} cards
                  </span>
                </label>
              </li>
            )}
          </For>
        </ul>

        <DialogFooter class='gap-2'>
          <Button type='button' variant='outline' onClick={dismissUploadPrompt}>
            Not now
          </Button>
          <Button type='button' disabled={selected().size === 0} onClick={onUpload}>
            Upload selected ({selected().size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
