import { PlayArea } from '~/lib/playArea';
import { useMenuContext } from './context';
import { Dynamic } from 'solid-js/web';
import { discardFromTop, searchDeck, shuffleDeck } from '~/lib/shortcuts/commands/deck';
import { KEY } from '~/lib/constants';
import { shuffle } from 'lodash-es';

export default function DeckContextMenu(props: { playArea: PlayArea }) {
  const menuCtx = useMenuContext();

  return (
    <>
      <Dynamic component={menuCtx.item} onClick={() => props.playArea.draw()}>
        Draw Card<Dynamic component={menuCtx.shortcut}>d</Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.item} onClick={() => props.playArea.draw()}>
        Draw X Cards
      </Dynamic>
      <Dynamic component={menuCtx.menu}>
        <Dynamic component={menuCtx.trigger}>Draw</Dynamic>
        <Dynamic component={menuCtx.content}>
          <Dynamic component={menuCtx.item}>X Cards</Dynamic>
          <Dynamic component={menuCtx.item}>Until Next Land</Dynamic>
        </Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.separator} />
      <Dynamic component={menuCtx.item} onClick={() => discardFromTop(props.playArea)}>
        Discard 1 <Dynamic component={menuCtx.shortcut}>{KEY.Mod} d</Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.menu}>
        <Dynamic component={menuCtx.trigger}>Discard</Dynamic>
        <Dynamic component={menuCtx.content}>
          <Dynamic component={menuCtx.item}>X Cards</Dynamic>
          <Dynamic component={menuCtx.item}>Until Next Land</Dynamic>
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
