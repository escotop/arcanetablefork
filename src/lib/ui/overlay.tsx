import hotkeys from 'hotkeys-js';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  Show,
  type Component,
} from 'solid-js';
import { Mesh } from 'three';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '~/components/ui/dialog';
import {
  Menubar,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
} from '../../components/ui/menubar';
import { KEY } from '../constants';
import {
  cardsById,
  dispatchGameEvent,
  focusRenderer,
  hoverSignal,
  isSpectating,
  onConcede,
  playAreas,
  players,
  provider,
  selection,
  setSettings,
  settings,
} from '../globals';
import CommandPalette from '../shortcuts/command-palette';
import { untapAll } from '../shortcuts/commands/field';
import HotkeysTable from '../shortcuts/hotkeys-table';
import CardOverlay from './cardOverlay';
import CounterDialog from './counterDialog';
import Log from './log';
import MoveMenu from './moveMenu';
import styles from './overlay.module.css';
import PeekMenu from './peekMenu';
import { LocalPlayer, NetworkPlayer } from './playerMenu';
import RevealMenu from './revealMenu';
import TokenSearchMenu from './tokenMenu';
import { useSearchParams } from '@solidjs/router';
import SettingsOverlay from './settingsOverlay';
import { PlayArea } from '../playArea';
import { createPassTurnEvent } from '../createEvents';
import Announcement from './announcement';
import ContextMenuHandler from './context-menu/handler';

export default function Overlay() {
  let userData = () => hoverSignal()?.mesh?.userData;
  const [searchParams, setSearchParams] = useSearchParams();

  const isPublic = () => userData()?.isPublic;
  const isOwner = () => userData()?.clientId === provider?.awareness?.clientID;
  const location = () => userData()?.location;
  const cardMesh = () => hoverSignal()?.mesh;
  const tether = () => hoverSignal()?.tether;
  const playArea = playAreas[provider?.awareness?.clientID];
  const focusCameraStyle = () => {
    if (hoverSignal()?.mouse?.y > 0) {
      return { right: `0px`, bottom: '0' };
    }
    return { right: `0px`, top: `0` };
  };
  const isCardOwnedByPlayer = (cardMesh: Mesh) =>
    cardMesh?.userData?.clientId === provider.awareness.clientID;

  let currentPlayer = () => players().find(player => player.id === provider?.awareness?.clientID);

  let [container, setContainer] = createSignal();

  createEffect(() => {
    hotkeys.setScope(location());
  });

  createEffect(() => {
    let parent = container() as HTMLDivElement;
    if (!parent) return;
    parent.appendChild(focusRenderer.domElement);
  });

  return (
    <div
      class={styles.App}
      onClick={e => {
        e.stopImmediatePropagation();
      }}>
      <div class={styles.top}>
        <div class='flex flex-wrap justify-start p-2 gap-2 items-start'>
          <Show when={!isSpectating()}>
            <LocalPlayer {...currentPlayer()?.entry} />
          </Show>
          <For
            each={players().filter(
              player => player.id !== provider.awareness.clientID && !player.entry.isSpectating,
            )}>
            {player => <NetworkPlayer {...player?.entry} />}
          </For>
        </div>
      </div>
      <div class={styles.focusCamera} style={focusCameraStyle()}>
        <Show
          when={
            hoverSignal()?.mesh &&
            (isPublic() ||
              isSpectating() ||
              (isOwner() && ['battlefield', 'peek', 'hand'].includes(location())))
          }>
          <div ref={setContainer} class={styles.focusCameraContainer} />
        </Show>
      </div>
      <Show when={tether() && isCardOwnedByPlayer(cardMesh())}>
        <div
          class={styles.cardActions}
          style={`--x: ${tether().x}px; --y: ${tether().y}px; --offset-x: ${tether().offset?.x || 0}; --offset-y: ${tether().offset?.y || 0};`}
          onClick={e => {
            e.stopImmediatePropagation();
          }}>
          <CardOverlay cardMesh={cardMesh()} playArea={playArea} />
        </div>
      </Show>
      <MainMenu playArea={playArea} />
      <PeekMenu />
      <RevealMenu />
      <TokenSearchMenu />
      <ContextMenuHandler playArea={playArea} />
      <CounterDialog />
      <Announcement />
      <CommandPalette playArea={playArea} />
    </div>
  );
}

export function MainMenu(props: { playArea?: PlayArea }) {
  let [isLogVisible, setIsLogVisible] = createSignal(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const isDialogVisible = (dialog: string) => dialog === searchParams.dialog;
  const setVisibleDialog = (dialog?: string) => {
    setSearchParams({ dialog }, { replace: !dialog });
  };

  return (
    <div class={styles.mainMenu}>
      <Menubar
        style='height: auto; white-space: nowrap;'
        class={`${styles.menu} flex-col items-start`}>
        <MenubarMenu>
          <MenubarItem class='w-full' onClick={() => setIsLogVisible(visible => !visible)}>
            {isLogVisible() ? 'Hide Log' : 'Show Log'}
          </MenubarItem>
          <MenubarSeparator />
          <Dialog
            open={isDialogVisible('shortcuts')}
            onOpenChange={isOpen => setVisibleDialog(isOpen ? 'shortcuts' : undefined)}>
            <DialogTrigger as={MenubarItem} class='w-full'>
              Shortcuts
            </DialogTrigger>
            <DialogContent class='max-w-xl'>
              <DialogHeader>Shortcuts</DialogHeader>
              <DialogDescription>
                <HotkeysTable />
              </DialogDescription>
              <DialogFooter>
                <Button onClick={() => setVisibleDialog()}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <SettingsOverlay
            isOpen={isDialogVisible('settings')}
            onOpen={() => setVisibleDialog('settings')}
            onClose={() => setVisibleDialog(undefined)}
          />

          <Dialog
            open={isDialogVisible('donate')}
            onOpenChange={isOpen => setVisibleDialog(isOpen ? 'donate' : undefined)}>
            <DialogTrigger as={MenubarItem} class='w-full'>
              Support Us
            </DialogTrigger>
            <DialogContent class='max-w-xl'>
              <DialogHeader>Support Arcanetable Development</DialogHeader>
              <DialogDescription>
                <iframe
                  id='kofiframe'
                  src='https://ko-fi.com/sparkstonepdx/?hidefeed=true&widget=true&embed=true&preview=true'
                  style='border:none;width:100%; border-radius: 8px;'
                  height='712'
                  title='sparkstonepdx'></iframe>
              </DialogDescription>
              <DialogFooter>
                <Button onClick={() => setVisibleDialog()}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </MenubarMenu>
      </Menubar>
      <Show when={isLogVisible()}>
        <Log />
      </Show>
    </div>
  );
}
