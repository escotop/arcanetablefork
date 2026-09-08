import { Accessor, Component, onMount, Show } from 'solid-js';
import { SetStoreFunction } from 'solid-js/store';
import { Button } from '~/components/ui/button';
import AddIcon from 'lucide-solid/icons/plus';
import SubIcon from 'lucide-solid/icons/minus';
import SearchIcon from 'lucide-solid/icons/search';
import ImagesIcon from 'lucide-solid/icons/images';
import StarIcon from 'lucide-solid/icons/star';
import ArrowRightIcon from 'lucide-solid/icons/arrow-right';
import ArrowLeftIcon from 'lucide-solid/icons/arrow-left';
import random from 'lodash-es/random';
import { getCardImage } from '~/lib/card';
import { DetailedCardEntry, Deck } from '~/lib/constants';
import { canBeCommander, isCommanderCard } from '~/lib/deckCommander';
import { CardPrintingOption, prefetchCardPrintings, supportsCardPrintings } from '~/lib/deck';
import { cardSystem } from '~/lib/globals';
import { cn } from '~/lib/cnUtil';
import PrintingSelect from './printingSelect';

interface Props {
  storageKey: string;
  index: number;
  card: Accessor<DetailedCardEntry | undefined>;
  updateDeck: SetStoreFunction<Deck>;
  onChangePrinting(storageKey: string, printing: CardPrintingOption): void;
  onPreview(src: string): void;
  onOpenPrintings?(): void;
  onToggleCommander?(storageKey: string): void;
  onSendToSideboard?(storageKey: string): void;
  onSendToDeck?(storageKey: string): void;
  section?: 'cards' | 'sideboard';
  variant?: 'default' | 'token';
  pinnedPrintings?: CardPrintingOption[];
}

const DeckGridCard: Component<Props> = props => {
  const isToken = () => props.variant === 'token';
  const isCommander = () => isCommanderCard(props.card());
  const section = () => props.section ?? 'cards';
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
      }}
      onMouseDown={e => {
        if (e.button !== 2 || !supportsCardPrintings() || !(props.card()?.qty > 0)) return;
        const name = props.card()?.name;
        if (name) prefetchCardPrintings(name);
      }}>
      <img
        src={
          getCardImage(props.card()) ??
          cardSystem.fallbackImage ??
          '/unknown-card-image.webp'
        }
        style={`anchor-name: --card-${props.index}; height: 100%;`}
      />
      <Show
        when={
          !isToken() &&
          props.card()?.qty > 0 &&
          props.onToggleCommander &&
          (canBeCommander(props.card()) || isCommander())
        }>
        <div
          class='absolute top-2 left-2 z-20'
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}>
          <Button
            type='button'
            variant='secondary'
            size='icon'
            class={cn('size-7 shadow-md', isCommander() && 'text-yellow-400')}
            title={isCommander() ? 'Remove commander' : 'Mark as commander'}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              props.onToggleCommander?.(props.storageKey);
            }}>
            <StarIcon class={cn('size-4', isCommander() && 'fill-current')} />
          </Button>
        </div>
      </Show>
      <Show when={isToken() && props.card()?.qty > 0 && supportsCardPrintings()}>
        <div
          class='absolute bottom-2 right-2 z-20'
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}>
          <PrintingSelect
            entry={props.card()!}
            pinnedPrintings={props.pinnedPrintings}
            onSelect={printing => props.onChangePrinting(props.storageKey, printing)}
          />
        </div>
      </Show>
      <div
        class='absolute inset-0 fade-in flex items-end justify-center'
        style={`
          position-anchor: --card-${props.index};
          left: anchor(left);
          width: anchor-size(width);
          height: anchor-size(height);
          container-type: size;
          padding-bottom: 18cqh;
          --delay: ${750 + props.index * 25}ms;
          --timing: 750ms;
        `}>
          <div
            class='dark font-bold text-white flex w-fit flex-col items-center gap-1 rounded px-1 py-1'
            style='background: hsla(var(--background) / .4);'
            onPointerDown={e => e.stopPropagation()}>
            <Show when={!props.card()?.detail?.name || !getCardImage(props.card())}>
              <div class='px-2 text-center text-sm'>{props.card()?.name}</div>
            </Show>
            <Show when={!isToken()}>
              <div class='flex items-center justify-center gap-2'>
                <Show when={props.card()?.qty > 0}>
                  <Button
                    size='icon'
                    variant='ghost'
                    type='button'
                    onClick={() =>
                      props.updateDeck(section(), props.storageKey, 'qty', (qty = 1) =>
                        Math.max(qty - 1, 0),
                      )
                    }>
                    <SubIcon class='text-white' style='filter: drop-shadow(2px 4px 6px black);' />
                  </Button>
                  <span>{props.card()?.qty}</span>
                </Show>
                <Button
                  size='icon'
                  variant='ghost'
                  type='button'
                  onClick={() => {
                    const card = props.card();
                    if (!card) return;
                    if (props.card()?.qty > 0) {
                      return props.updateDeck(section(), props.storageKey, 'qty', (qty = 1) => qty + 1);
                    }
                    props.updateDeck(section(), props.storageKey, { ...card, qty: 1 });
                  }}>
                  <AddIcon class='text-white' style='filter: drop-shadow(2px 4px 6px black);' />
                </Button>
              </div>
            </Show>
            <div class='flex items-center justify-center gap-2'>
              <Show when={props.card()?.qty > 0 && supportsCardPrintings()}>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  title='Choose printing'
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onOpenPrintings?.();
                  }}>
                  <ImagesIcon class='text-white' style='filter: drop-shadow(2px 4px 6px black);' />
                </Button>
              </Show>
              <Show when={props.card()?.qty > 0 && !isToken() && props.onSendToSideboard}>
                <Button
                  size='icon'
                  variant='ghost'
                  type='button'
                  title='Send to sideboard'
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onSendToSideboard?.(props.storageKey);
                  }}>
                  <ArrowRightIcon
                    class='text-white'
                    style='filter: drop-shadow(2px 4px 6px black);'
                  />
                </Button>
              </Show>
              <Show when={props.card()?.qty > 0 && !isToken() && props.onSendToDeck}>
                <Button
                  size='icon'
                  variant='ghost'
                  type='button'
                  title='Send to deck'
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onSendToDeck?.(props.storageKey);
                  }}>
                  <ArrowLeftIcon
                    class='text-white'
                    style='filter: drop-shadow(2px 4px 6px black);'
                  />
                </Button>
              </Show>
              <Show when={props.card()?.detail?.name && getCardImage(props.card())}>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  title='Preview card'
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const src = getCardImage(props.card());
                    if (src) props.onPreview(src);
                  }}>
                  <SearchIcon class='text-white' style='filter: drop-shadow(2px 4px 6px black);' />
                </Button>
              </Show>
            </div>
          </div>
      </div>
    </div>
  );
};

export default DeckGridCard;
