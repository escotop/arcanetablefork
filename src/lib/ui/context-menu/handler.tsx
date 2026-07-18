import { JSX, Match, Show, Switch } from 'solid-js';
import { contextMenuSignal, setContextMenuSignal } from '~/lib/globals';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '~/components/ui/dropdown-menu';
import { PlayArea } from '~/lib/playArea';
import TableContextMenu from './table';
import { DropdownMenuElements, MenuContext, MenuContextProvider } from './context';


export default function ContextMenuHandler(props: { playArea: PlayArea }) {
  return (
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
                <Match when>
                  <TableContextMenu playArea={props.playArea} />
                </Match>
              </Switch>
            </DropdownMenuContent>
          </DropdownMenu>
        </MenuContextProvider>
      )}
    </Show>
  );
}
