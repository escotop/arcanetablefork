import { Dynamic } from 'solid-js/web';
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
import { dispatchGameEvent, onConcede } from '~/lib/globals';
import { createPassTurnEvent } from '~/lib/createEvents';
import { Button } from '~/components/ui/button';
import MoveSubMenu from './move-submenu';
import { useMenuContext } from './context';
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
          dispatchGameEvent(createPassTurnEvent());
        }}>
        Pass Turn <Dynamic component={menuCtx.shortcut}>[ _ ]</Dynamic>
      </Dynamic>
      <Dynamic component={menuCtx.separator} class='w-full' />
      <Dynamic
        component={menuCtx.item}
        class='w-full flex'
        onClick={() => props.playArea.toggleTokenMenu()}>
        Related Cards
      </Dynamic>
      <MoveSubMenu
        text='Move All Cards'
        cards={props.playArea.battlefieldZone.cards}
        fromZone={props.playArea.battlefieldZone}
        playArea={props.playArea}
      />
      <Dialog
        open={searchParams.dialog === 'concede'}
        onOpenChange={isOpen => setSearchParams({ dialog: isOpen ? 'concede' : undefined })}>
        <DialogTrigger as={menuCtx.item} class='w-full'>
          Concede
        </DialogTrigger>
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
    </>
  );
}
