import { PlayArea } from '~/lib/playArea';
import { useMenuContext } from './context';
import { Dynamic, Match, Switch } from 'solid-js/web';
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

export default function DeckContextMenu(props: { playArea: PlayArea }) {
  const menuCtx = useMenuContext();
  const [searchParams, setSearchParams] = useSearchParams();

  function getNextLandIndex() {
    return props.playArea.deck.cards.findIndex(card =>
      card.detail.type_line.toLowerCase().includes('land'),
    );
  }

  return (
    <>
      <Dynamic component={menuCtx.item} onClick={() => props.playArea.draw()}>
        Draw Card<Dynamic component={menuCtx.shortcut}>d</Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.menu}>
        <Dynamic component={menuCtx.trigger}>Draw</Dynamic>
        <Dynamic component={menuCtx.content}>
          <Dynamic
            component={menuCtx.item}
            onClick={() => setSearchParams({ dialog: 'deck-to-hand' })}>
            X Cards
          </Dynamic>
          <Dynamic
            component={menuCtx.item}
            onClick={() => drawCards(props.playArea, getNextLandIndex() + 1)}>
            Until Next Land
          </Dynamic>
          <Dynamic
            component={menuCtx.item}
            onClick={() => drawCards(props.playArea, props.playArea.deck.cards.length)}>
            All
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.separator} />
      <Dynamic component={menuCtx.item} onClick={() => peekFromTop(props.playArea)}>
        Peek Top Card
      </Dynamic>
      <Dynamic component={menuCtx.item} onClick={() => setSearchParams({ dialog: 'deck-to-peek' })}>
        Peek Top X Cards
      </Dynamic>
      <Dynamic component={menuCtx.separator} />
      <Dynamic component={menuCtx.menu}>
        <Dynamic component={menuCtx.trigger}>Reveal Cards</Dynamic>
        <Dynamic component={menuCtx.content}>
          <Dynamic
            component={menuCtx.item}
            onClick={() => setSearchParams({ dialog: 'deck-to-peek' })}>
            To you
          </Dynamic>
          <Dynamic
            component={menuCtx.item}
            onClick={() => setSearchParams({ dialog: 'deck-to-reveal' })}>
            To Everyone
          </Dynamic>
        </Dynamic>
      </Dynamic>

      <Dynamic component={menuCtx.separator} />
      <Dynamic component={menuCtx.menu}>
        <Dynamic component={menuCtx.trigger}>Discard</Dynamic>
        <Dynamic component={menuCtx.content}>
          <Dynamic
            component={menuCtx.item}
            onClick={() => setSearchParams({ dialog: 'deck-to-discard' })}>
            X Cards
          </Dynamic>
          <Dynamic
            component={menuCtx.item}
            onClick={() => discardFromTop(props.playArea, getNextLandIndex() + 1)}>
            Until Next Land
          </Dynamic>
          <Dynamic
            component={menuCtx.item}
            onClick={() => discardFromTop(props.playArea, props.playArea.deck.cards.length)}>
            All
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.menu}>
        <Dynamic component={menuCtx.trigger}>Exile</Dynamic>
        <Dynamic component={menuCtx.content}>
          <Dynamic
            component={menuCtx.item}
            onClick={() => setSearchParams({ dialog: 'deck-to-exile' })}>
            X Cards
          </Dynamic>
          <Dynamic
            component={menuCtx.item}
            onClick={() => exileFromTop(props.playArea, getNextLandIndex() + 1)}>
            Until Next Land
          </Dynamic>
          <Dynamic
            component={menuCtx.item}
            onClick={() => exileFromTop(props.playArea, props.playArea.deck.cards.length)}>
            All
          </Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.separator} />
      <Dynamic component={menuCtx.item} onClick={() => searchDeck(props.playArea)}>
        Search <Dynamic component={menuCtx.shortcut}>s</Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.separator} />
      <Dynamic component={menuCtx.item} onClick={() => shuffleDeck(props.playArea)}>
        Shuffle
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
