import { Dynamic, Match, Switch } from 'solid-js/web';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '~/components/ui/dialog';
import { KEY } from '~/lib/constants';
import { PlayArea } from '~/lib/playArea';
import { untapAll } from '~/lib/shortcuts/commands/field';
import { useSearchParams } from '@solidjs/router';
import {
  contextMenuSignal,
  customCardSpawnScreenPoint,
  dispatchGameEvent,
  onConcede,
  setCustomCardSpawnScreenPoint,
} from '~/lib/globals';
import { createPassTurnEvent } from '~/lib/createEvents';
import { computeNextTurnState } from '~/lib/turnOrder';
import { Button } from '~/components/ui/button';
import MoveSubMenu from './move-submenu';
import { useMenuContext } from './context';
import {
  resolveBattlefieldPositionFromScreen,
  spawnCustomCardOnBattlefield,
} from '~/lib/customBattlefieldCard';
import CustomCardModal from '../customCardModal';
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '~/components/ui/dropdown-menu';

interface MenuActionsProps {
  playArea: PlayArea;
}

export default function TableMenuItems(props: MenuActionsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const menuCtx = useMenuContext();

  return (
    <>
      <Dynamic
        component={menuCtx.item}
        class='w-full flex'
        onClick={() => untapAll(props.playArea)}>
        Untap All <Dynamic component={menuCtx.shortcut}>{KEY.Shift}R</Dynamic>
      </Dynamic>
      <Dynamic
        component={menuCtx.item}
        class='w-full'
        onClick={() => {
          dispatchGameEvent(createPassTurnEvent(computeNextTurnState()));
        }}>
        Pass Turn <Dynamic component={menuCtx.shortcut}>space</Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.separator} class='w-full' />
      <Dynamic
        component={menuCtx.item}
        class='w-full flex'
        onClick={() => {
          const signal = contextMenuSignal();
          if (signal) {
            setCustomCardSpawnScreenPoint({ x: signal.mouse.x, y: signal.mouse.y });
          }
          setSearchParams({ dialog: 'add-custom-card' });
        }}>
        Add custom card
      </Dynamic>
      <Dynamic
        component={menuCtx.item}
        class='w-full flex'
        onClick={() => props.playArea.toggleTokenMenu()}>
        Tokens
      </Dynamic>
      <MoveSubMenu
        text={`Move All ${props.playArea.battlefieldZone.cards.length} Cards on Field`}
        cards={props.playArea.battlefieldZone.cards}
        fromZone={props.playArea.battlefieldZone}
        playArea={props.playArea}
      />
      <Dynamic component={menuCtx.item} onClick={() => setSearchParams({ dialog: 'concede' })}>
        Concede
      </Dynamic>
    </>
  );
}

export function TableContextDialogs(props: { playArea: PlayArea }) {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <Switch>
      <Match when={searchParams.dialog === 'add-custom-card'}>
        <CustomCardModal
          onClose={() => {
            setCustomCardSpawnScreenPoint(null);
            setSearchParams({ dialog: undefined });
          }}
          onConfirm={(frontUrl, backUrl) => {
            const point = customCardSpawnScreenPoint();
            const position = point
              ? resolveBattlefieldPositionFromScreen(point.x, point.y)
              : undefined;
            spawnCustomCardOnBattlefield(props.playArea, frontUrl, backUrl, position);
            setCustomCardSpawnScreenPoint(null);
          }}
        />
      </Match>
      <Match when={searchParams.dialog === 'concede'}>
        <Dialog
          open
          onOpenChange={isOpen => setSearchParams({ dialog: isOpen ? 'concede' : undefined })}>
          <DialogContent>
            <DialogHeader>Are you sure you want to concede?</DialogHeader>
            <DialogDescription>
              Conceding will allow you to spectate until the session ends
            </DialogDescription>
            <DialogFooter>
              <Button onClick={() => setSearchParams({ dialog: undefined })} variant='ghost'>
                Cancel
              </Button>
              <Button onClick={() => onConcede()}>Concede</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Match>
    </Switch>
  );
}
