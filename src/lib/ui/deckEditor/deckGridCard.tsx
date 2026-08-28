import { Accessor, Component, onMount, Show } from 'solid-js';
import { SetStoreFunction } from 'solid-js/store';
import { Button } from '~/components/ui/button';
import AddIcon from 'lucide-solid/icons/plus';
import SubIcon from 'lucide-solid/icons/minus';
import SearchIcon from 'lucide-solid/icons/search';
import random from 'lodash-es/random';
import { getCardImage } from '~/lib/card';
import { DetailedCardEntry, Deck } from '~/lib/constants';
import { CardPrintingOption, supportsCardPrintings } from '~/lib/deck';
import { cardSystem } from '~/lib/globals';
import PrintingSelect from './printingSelect';

interface Props {
  storageKey: string;
  index: number;
  card: Accessor<DetailedCardEntry | undefined>;
  updateDeck: SetStoreFunction<Deck>;
  onChangePrinting(storageKey: string, printing: CardPrintingOption): void;
  onPreview(src: string): void;
  onOpenPrintings?(): void;
}

const DeckGridCard: Component<Props> = props => {
  let rootRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!rootRef) return;
    rootRef.style.setProperty('--timing', `${random(400, 600)}ms`);
    rootRef.style.setProperty('--delay', `${random(250, 500)}ms`);
    rootRef.style.setProperty('--distance', `${random(20, 100)}px`);
  });

  return (
    <div
      ref={rootRef}
      data-index={props.index}
      id={props.card()?.id}
      style='position: relative; content-visibility: auto;'
      class='fade-in-from-below'
      onContextMenu={e => {
        if (!supportsCardPrintings() || !(props.card()?.qty > 0)) return;
        e.preventDefault();
        e.stopPropagation();
        props.onOpenPrintings?.();
      }}>
      <img
        crossOrigin=''
        src={
          getCardImage(props.card()) ??
          cardSystem.fallbackImage ??
          '/unknown-card-image.webp'
        }
        style={`anchor-name: --card-${props.index}; height: 100%;`}
      />
      <Show when={props.card()?.qty > 0 && supportsCardPrintings()}>
        <div
          class='absolute bottom-2 right-2 z-20'
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}>
          <PrintingSelect
            entry={props.card()!}
            onSelect={printing => props.onChangePrinting(props.storageKey, printing)}
          />
        </div>
      </Show>
      <div
        class='absolute inset-0 fade-in'
        style={`
          position-anchor: --card-${props.index};
          right: anchor(right);
          height: anchor-size(height);
          container-type: size;
          --delay: ${750 + props.index * 25}ms;
          --timing: 750ms;
        `}>
        <div
          class='grid place-items-center justify-end'
          style={`
            height: 100%;
            padding-inline: 10cqw;
            padding-bottom: 10cqh;
          `}>
          <div
            class='dark gap-2 font-bold text-white flex items-center rounded'
            style='background: hsla(var(--background) / .4);'>
            <Show
              when={!props.card()?.detail?.name || !getCardImage(props.card())}
              fallback={
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => {
                    const src = getCardImage(props.card());
                    if (src) props.onPreview(src);
                  }}>
                  <SearchIcon />
                </Button>
              }>
              <div class='pl-2'>{props.card()?.name}</div>
            </Show>
            <Show when={props.card()?.qty > 0}>
              <Button
                size='icon'
                variant='ghost'
                type='button'
                onClick={() =>
                  props.updateDeck('cards', props.storageKey, 'qty', (qty = 1) =>
                    Math.max(qty - 1, 0),
                  )
                }>
                <SubIcon class='text-white' style='filter: drop-shadow(2px 4px 6px black);' />
              </Button>
            </Show>
            <Show when={props.card()?.qty > 0}>{props.card()?.qty}</Show>
            <Button
              size='icon'
              variant='ghost'
              type='button'
              onClick={() => {
                const card = props.card();
                if (!card) return;
                if (props.card()?.qty > 0) {
                  return props.updateDeck('cards', props.storageKey, 'qty', (qty = 1) => qty + 1);
                }
                props.updateDeck('cards', props.storageKey, { ...card, qty: 1 });
              }}>
              <AddIcon class='text-white' style='filter: drop-shadow(2px 4px 6px black);' />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeckGridCard;
