import { createMemo, createSignal, JSX, Match, Show, Switch } from 'solid-js';
import { contextMenuSignal, setContextMenuSignal } from '~/lib/globals';
import { DropdownMenu, DropdownMenuContent } from '~/components/ui/dropdown-menu';
import { PlayArea } from '~/lib/playArea';
import TableContextMenu, { TableContextDialogs } from './table';
import { DropdownMenuElements, MenuContext, MenuContextProvider } from './context';
import DeckContextMenu, { DeckContextDialogs } from './deck';
import BattlefieldContextMenu, { BattlefieldContextDialogs } from './battlefield';
import HandContextMenu from './hand';

export default function ContextMenuHandler(props: { playArea: PlayArea }) {
  const target = createMemo(() => contextMenuSignal()?.target);
  const location = createMemo(() => target()?.userData?.location);

  return (
    <>
      <Show when={contextMenuSignal()}>
        {contextMenuSignal => (
          <MenuContextProvider components={DropdownMenuElements}>
            <DropdownMenu
              onOpenChange={isOpen => !isOpen && setContextMenuSignal()}
              open
              getAnchorRect={() => {
                const mouse = contextMenuSignal().mouse;
                return { x: mouse.x, y: mouse.y, width: 0, height: 0 };
              }}>
              <DropdownMenuContent>
                <Switch>
                  <Match when={location() === 'deck'}>
                    <DeckContextMenu playArea={props.playArea} />
                  </Match>
                  <Match when={location() === 'battlefield'}>
                    <BattlefieldContextMenu
                      targetMesh={contextMenuSignal().target}
                      playArea={props.playArea}
                    />
                  </Match>
                  <Match when={location() === 'hand'}>
                    <HandContextMenu
                      playArea={props.playArea}
                      targetMesh={contextMenuSignal().target}
                    />
                  </Match>
                  <Match when>
                    <TableContextMenu playArea={props.playArea} />
                  </Match>
                </Switch>
              </DropdownMenuContent>
            </DropdownMenu>
          </MenuContextProvider>
        )}
      </Show>
      <TableContextDialogs playArea={props.playArea} />
      <DeckContextDialogs playArea={props.playArea} />
      <BattlefieldContextDialogs playArea={props.playArea} />
    </>
  );
}
