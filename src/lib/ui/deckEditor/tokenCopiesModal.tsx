import { Component, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContentExtended,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
} from '~/components/ui/dialog';
import AddIcon from 'lucide-solid/icons/plus';
import SubIcon from 'lucide-solid/icons/minus';
import { DetailedCardEntry } from '~/lib/constants';
import { getCardImage } from '~/lib/card';
import { getTokenKey } from '~/lib/deckTokens';
import { cardSystem } from '~/lib/globals';

export const MAX_TOKEN_PRINT_COPIES = 40;

interface Props {
  open: boolean;
  tokens: DetailedCardEntry[];
  copies: Record<string, number>;
  /** Empty slots on the last printed page with the current selection. */
  freeSlots: number;
  cardsPerPage: number;
  onChange(tokenKey: string, copies: number): void;
  onReset(): void;
  onClose(): void;
}

const TokenCopiesModal: Component<Props> = props => {
  const copiesOf = (token: DetailedCardEntry) => props.copies[getTokenKey(token.detail)] ?? 1;
  const setCopies = (token: DetailedCardEntry, value: number) =>
    props.onChange(
      getTokenKey(token.detail),
      Math.min(MAX_TOKEN_PRINT_COPIES, Math.max(0, Math.round(value) || 0)),
    );

  return (
    // Only mount while open: the full-screen wrapper below would otherwise sit on top of the
    // page invisibly and swallow every click.
    <Show when={props.open}>
    <Dialog modal open={props.open} onOpenChange={open => !open && props.onClose()}>
      <Portal>
        <div class='fixed inset-0 z-[80] flex items-start justify-center sm:items-center'>
          <DialogOverlay class='z-[80]' />
          <DialogContentExtended class='z-[80] flex max-h-[85vh] max-w-lg flex-col'>
            <DialogHeader>
              <DialogTitle>Extra token copies</DialogTitle>
            </DialogHeader>

            <div
              class={
                props.freeSlots === 0
                  ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm'
                  : 'rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm'
              }>
              {props.freeSlots === 0
                ? 'The last page is full — no empty slots.'
                : `${props.freeSlots} empty slot${props.freeSlots === 1 ? '' : 's'} left on the last page (of ${props.cardsPerPage}).`}
            </div>

            <div class='min-h-0 flex-1 overflow-y-auto'>
              <ul class='grid gap-2'>
                <For each={props.tokens}>
                  {token => (
                    <li class='flex items-center gap-3 rounded-md border p-2'>
                      <img
                        class='h-14 rounded-[4.75%]'
                        loading='lazy'
                        src={getCardImage(token) ?? cardSystem.fallbackImage ?? '/unknown-card-image.webp'}
                        alt={token.name}
                      />
                      <div class='min-w-0 flex-1'>
                        <div class='truncate text-sm font-medium'>{token.name}</div>
                        <div class='truncate text-xs text-muted-foreground'>
                          {token.detail?.type_line?.replace(/^Token\s*/, '')}
                        </div>
                      </div>
                      <div class='flex items-center gap-1'>
                        <Button
                          type='button'
                          size='icon'
                          variant='ghost'
                          title='One copy less'
                          disabled={copiesOf(token) <= 0}
                          onClick={() => setCopies(token, copiesOf(token) - 1)}>
                          <SubIcon class='size-4' />
                        </Button>
                        <input
                          type='number'
                          min='0'
                          max={MAX_TOKEN_PRINT_COPIES}
                          aria-label={`Copies of ${token.name}`}
                          class='h-9 w-14 rounded-md border border-input bg-transparent text-center text-sm'
                          value={copiesOf(token)}
                          onChange={e => setCopies(token, Number(e.currentTarget.value))}
                        />
                        <Button
                          type='button'
                          size='icon'
                          variant='ghost'
                          title='One copy more'
                          disabled={copiesOf(token) >= MAX_TOKEN_PRINT_COPIES}
                          onClick={() => setCopies(token, copiesOf(token) + 1)}>
                          <AddIcon class='size-4' />
                        </Button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' onClick={props.onReset}>
                Reset to 1
              </Button>
              <Button type='button' onClick={props.onClose}>
                Done
              </Button>
            </DialogFooter>
          </DialogContentExtended>
        </div>
      </Portal>
    </Dialog>
    </Show>
  );
};

export default TokenCopiesModal;
