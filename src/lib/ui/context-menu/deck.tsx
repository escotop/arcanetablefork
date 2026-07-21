import { PlayArea } from '~/lib/playArea';
import { useMenuContext } from './context';
import { Dynamic, For, Match, Switch } from 'solid-js/web';
import {
  discardFromTop,
  drawCards,
  exileFromTop,
  peekFromTop,
  revealFromTop,
  searchDeck,
  shuffleDeck,
} from '~/lib/shortcuts/commands/deck';
import { KEY } from '~/lib/constants';
import CardQtyDialog from '../card-qty-dialog';
import { DialogTrigger } from '~/components/ui/dialog';
import { useSearchParams } from '@solidjs/router';
import { DropdownMenuGroupLabel } from '~/components/ui/dropdown-menu';

export default function DeckContextMenu(props: { playArea: PlayArea }) {
  const ctx = useMenuContext();
  const [searchParams, setSearchParams] = useSearchParams();

  function getNextLandIndex() {
    return props.playArea.deck.cards.findIndex(card =>
      card.detail.type_line.toLowerCase().includes('land'),
    );
  }

  return (
    <>
      <Dynamic component={ctx.item} onClick={() => props.playArea.draw()}>
        Draw Card<Dynamic component={ctx.shortcut}>d</Dynamic>
      </Dynamic>
      <Dynamic component={ctx.menu}>
        <Dynamic component={ctx.trigger}>Draw</Dynamic>
        <Dynamic component={ctx.content}>
          <Dynamic component={ctx.item} onClick={() => setSearchParams({ dialog: 'deck-to-hand' })}>
            X Cards
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => drawCards(props.playArea, getNextLandIndex() + 1)}>
            Until Next Land
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => drawCards(props.playArea, props.playArea.deck.cards.length)}>
            All
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={ctx.separator} />
      <Dynamic component={ctx.item} onClick={() => peekFromTop(props.playArea)}>
        Peek Top Card
      </Dynamic>
      <Dynamic component={ctx.item} onClick={() => setSearchParams({ dialog: 'deck-to-peek' })}>
        Peek Top X Cards
      </Dynamic>
      <Dynamic component={ctx.separator} />
      <Dynamic component={ctx.menu}>
        <Dynamic component={ctx.trigger}>Reveal Cards</Dynamic>
        <Dynamic component={ctx.content}>
          <Dynamic component={ctx.item} onClick={() => setSearchParams({ dialog: 'deck-to-peek' })}>
            To you
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => setSearchParams({ dialog: 'deck-to-reveal' })}>
            To Everyone
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={ctx.menu}>
        <Dynamic component={ctx.trigger}>Flip</Dynamic>
        <Dynamic component={ctx.content}>
          <Dynamic component={ctx.item} onClick={() => props.playArea.deckFlipTop()}>
            One
          </Dynamic>
          <Dynamic component={ctx.item} onClick={() => props.playArea.deckFlipTop(true)}>
            Keep flipped
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={ctx.separator} />
      <Dynamic component={ctx.menu}>
        <Dynamic component={ctx.trigger}>Discard</Dynamic>
        <Dynamic component={ctx.content}>
          <Dynamic
            component={ctx.item}
            onClick={() => setSearchParams({ dialog: 'deck-to-discard' })}>
            X Cards
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => discardFromTop(props.playArea, getNextLandIndex() + 1)}>
            Until Next Land
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => discardFromTop(props.playArea, props.playArea.deck.cards.length)}>
            All
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={ctx.menu}>
        <Dynamic component={ctx.trigger}>Exile</Dynamic>
        <Dynamic component={ctx.content}>
          <Dynamic
            component={ctx.item}
            onClick={() => setSearchParams({ dialog: 'deck-to-exile' })}>
            X Cards
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => exileFromTop(props.playArea, getNextLandIndex() + 1)}>
            Until Next Land
          </Dynamic>
          <Dynamic
            component={ctx.item}
            onClick={() => exileFromTop(props.playArea, props.playArea.deck.cards.length)}>
            All
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={ctx.separator} />
      <Dynamic component={ctx.item} onClick={() => searchDeck(props.playArea)}>
        Search <Dynamic component={ctx.shortcut}>s</Dynamic>
      </Dynamic>
      <Dynamic component={ctx.separator} />
      <Dynamic component={ctx.item} onClick={() => shuffleDeck(props.playArea)}>
        Shuffle
      </Dynamic>
      <Dynamic component={ctx.separator} />
      <Dynamic component={ctx.menu}>
        <Dynamic component={ctx.trigger}>Mulligan</Dynamic>
        <Dynamic component={ctx.content}>
          <For each={Array(7).fill(0)}>
            {(_, i) => (
              <Dynamic component={ctx.item} onClick={() => props.playArea.mulligan(7 - i())}>
                {7 - i()} Cards
              </Dynamic>
            )}
          </For>
        </Dynamic>
      </Dynamic>
    </>
  );
}

export function DeckContextDialogs(props: { playArea: PlayArea }) {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Switch>
      <Match when={searchParams.dialog === 'deck-to-discard'}>
        <CardQtyDialog
          onSubmit={value => discardFromTop(props.playArea, value)}
          verb='Discard'
          item={['Cards', 'Card', 'Cards'] as const}
          header='Discard Cards from Deck'
          onClose={() => setSearchParams({ dialog: undefined })}
        />
      </Match>
      <Match when={searchParams.dialog === 'deck-to-exile'}>
        <CardQtyDialog
          onSubmit={value => exileFromTop(props.playArea, value)}
          verb='Exile'
          item={['Cards', 'Card', 'Cards']}
          header='Exile Cards from Deck'
          onClose={() => setSearchParams({ dialog: undefined })}
        />
      </Match>
      <Match when={searchParams.dialog === 'deck-to-hand'}>
        <CardQtyDialog
          onSubmit={value => drawCards(props.playArea, value)}
          verb='Draw'
          item={['Cards', 'Card', 'Cards']}
          header='Draw Cards from Deck'
          onClose={() => setSearchParams({ dialog: undefined })}
        />
      </Match>
      <Match when={searchParams.dialog === 'deck-to-peek'}>
        <CardQtyDialog
          onSubmit={value => peekFromTop(props.playArea, value)}
          verb='Peek at'
          item={['Cards', 'Card', 'Cards']}
          header='Peek at Cards from top of deck'
          onClose={() => setSearchParams({ dialog: undefined })}
        />
      </Match>
      <Match when={searchParams.dialog === 'deck-to-reveal'}>
        <CardQtyDialog
          onSubmit={value => revealFromTop(props.playArea, value)}
          verb='Reveal'
          item={['Cards', 'Card', 'Cards']}
          header='Reveal Cards from top of deck'
          onClose={() => setSearchParams({ dialog: undefined })}
        />
      </Match>
    </Switch>
  );
}
