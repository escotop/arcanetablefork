import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Menubar, MenubarItem, MenubarMenu, MenubarSeparator } from '../../components/ui/menubar';
import {
  cardsById,
  cardSearchModalData,
  cardSearchModalOpen,
  dispatchGameEvent,
  focusRenderer,
  getLocalPlayArea,
  getLocalPlayerClientId,
  getTetherCssVariables,
  getFocusPanelAspect,
  FOCUS_PANEL_WIDE_ASPECT,
  hoverSignal,
  isSpectating,
  onConcede,
  playAreas,
  selection,
  setCardSearchModalData,
  setCardSearchModalOpen,
  setSettings,
  settings,
  updateFocusPanelSize,
  FOCUS_PANEL_BASE_HEIGHT_RATIO,
} from '../globals';
import { CARD_HEIGHT, CARD_WIDTH } from '../constants';
import CommandPalette from '../shortcuts/command-palette';
import HotkeysTable from '../shortcuts/hotkeys-table';
import CounterDialog from './counterDialog';
import Log from './log';
import styles from './overlay.module.css';
import PeekMenu from './peekMenu';
import ManaCounters from './manaCounters';
import PlayerListPanel, { LocalPlayerPanel } from './playerListPanel';
import RevealMenu from './revealMenu';
import TokenSearchMenu from './tokenMenu';
import { useSearchParams } from '@solidjs/router';
import SettingsOverlay from './settingsOverlay';
import { PlayArea } from '../playArea';
import Announcement from './announcement';
import ContextMenuHandler from './context-menu/handler';
import PingWheel from './pingWheel';
import CameraTiltHints from './cameraTiltHints';
import HowItPlaysGameHelp from './howItPlaysGameHelp';
import CardSearchModal from './cardSearchModal';
import {
  isSpanishPreviewUiForCard,
  SPANISH_PREVIEW_NOT_FOUND_MESSAGE,
  spanishPreviewUi,
} from '../spanishCardPreview';
import LoaderIcon from 'lucide-solid/icons/loader-circle';

export default function Overlay() {
  let userData = () => hoverSignal()?.mesh?.userData;
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Limpiar modal de búsqueda al montar el componente
  createEffect(() => {
    setCardSearchModalOpen(false);
    setCardSearchModalData(null);
    
    // Limpiar activamente cualquier zona de búsqueda 3D que pueda existir
    const area = playArea();
    if (area) {
      // Limpiar peekZone 3D
      if (area.peekZone?.cards?.length > 0) {
        void area.dismissFromZone(area.peekZone);
      }
      // Limpiar tokenSearchZone 3D
      if (area.tokenSearchZone?.cards?.length > 0) {
        void area.dismissFromZone(area.tokenSearchZone);
      }
    }
  });

  const isPublic = () => userData()?.isPublic;
  const isOwner = () => userData()?.clientId === getLocalPlayerClientId();
  const location = () => userData()?.location;
  const playArea = () => getLocalPlayArea();
  const focusCameraStyle = () => {
    if (hoverSignal()?.mesh?.userData?.location === 'hand') {
      return { right: `0px`, top: `0` };
    }
    if (hoverSignal()?.mouse?.y > 0) {
      return { right: `0px`, bottom: '0' };
    }
    return { right: `0px`, top: `0` };
  };

  const focusPanelAspect = () => {
    const aspect = getFocusPanelAspect(hoverSignal()?.mesh);
    return aspect === FOCUS_PANEL_WIDE_ASPECT ? '750 / 700' : `${CARD_WIDTH} / ${CARD_HEIGHT}`;
  };

  let [container, setContainer] = createSignal();

  createEffect(() => {
    const parent = container() as HTMLDivElement | undefined;
    if (!parent) return;

    const canvas = focusRenderer.domElement;
    canvas.style.background = 'transparent';
    parent.appendChild(canvas);

    onCleanup(() => {
      canvas.remove();
    });
  });

  createEffect(() => {
    hoverSignal()?.mesh;
    settings.focusPanelScale;
    updateFocusPanelSize();
  });

  return (
    <div
      class={styles.App}
      onClick={e => {
        e.stopImmediatePropagation();
      }}>
      <CameraTiltHints />
      <LocalPlayerPanel />
      <PlayerListPanel />
      <div class={styles.focusCamera} style={focusCameraStyle()}>
        <Show
          when={
            hoverSignal()?.mesh &&
            (isPublic() ||
              isSpectating() ||
              (isOwner() && ['battlefield', 'peek', 'hand'].includes(location())))
          }>
          <div
            class={styles.focusCameraContainer}
            style={{
              '--focus-panel-height': `${FOCUS_PANEL_BASE_HEIGHT_RATIO * settings.focusPanelScale * 100}vh`,
              '--focus-panel-aspect': focusPanelAspect(),
            }}>
            <div ref={setContainer} class={styles.focusCanvasSlot} />
            <Show
              when={isSpanishPreviewUiForCard(hoverSignal()?.mesh?.userData?.id as string | undefined)}>
              <Show
                when={spanishPreviewUi()?.phase === 'loading'}
                fallback={
                  <Show when={spanishPreviewUi()?.phase === 'not-found'}>
                    <div class={styles.spanishPreviewOverlay}>
                      <p class={styles.spanishPreviewMessage}>
                        {SPANISH_PREVIEW_NOT_FOUND_MESSAGE}
                      </p>
                    </div>
                  </Show>
                }>
                <div class={styles.spanishPreviewOverlay}>
                  <LoaderIcon class='size-10 animate-spin opacity-90' />
                </div>
              </Show>
            </Show>
          </div>
        </Show>
      </div>
      <Show when={playArea()?.graveyardZone.observable.uiTether}>
        {tether => (
          <div
            class='text-shadow'
            style={`
              ${getTetherCssVariables(tether())}
              top: var(--y);
              left: var(--x);
              transform: translate(var(--offset-x), var(--offset-y));
              position: fixed;

            `}>
            Graveyard ({playArea()!.graveyardZone.observable.cardCount})
          </div>
        )}
      </Show>

      <Show when={playArea()?.exileZone.observable.uiTether}>
        {tether => (
          <div
            class='text-shadow'
            style={`
              ${getTetherCssVariables(tether())}
              top: var(--y);
              left: var(--x);
              transform: translate(var(--offset-x), var(--offset-y));
              position: fixed;

            `}>
            Exile ({playArea()!.exileZone.observable.cardCount})
          </div>
        )}
      </Show>

      <Show when={playArea()?.deck.observable.uiTether}>
        {tether => (
          <div
            class='text-shadow'
            style={`
              ${getTetherCssVariables(tether())}
              top: var(--y);
              left: var(--x);
              transform: translate(var(--offset-x), var(--offset-y));
              position: fixed;

            `}>
            Deck ({playArea()!.deck.observable.cardCount})
          </div>
        )}
      </Show>

      <MainMenu playArea={playArea()!} />
      <Show when={!isSpectating() && playArea()}>
        <HowItPlaysGameHelp playArea={playArea()} />
      </Show>
      <Show when={!isSpectating()}>
        <div class={styles.bottomRightHud}>
          <Show when={playArea()}>
            <div class={styles.handCounter}>
              Hand ({playArea()!.hand.observable.cardCount})
            </div>
          </Show>
          <ManaCounters />
        </div>
      </Show>
      <PeekMenu />
      <RevealMenu />
      <TokenSearchMenu />
      <ContextMenuHandler playArea={playArea()!} />
      <PingWheel />
      <CounterDialog />
      <Announcement />
      <CommandPalette playArea={playArea()!} />
      <Show when={cardSearchModalData()}>
        {data => (
          <CardSearchModal
            open={cardSearchModalOpen()}
            onOpenChange={setCardSearchModalOpen}
            cards={data().cards}
            zone={data().zone}
            title={data().title}
            deckViewMode={data().deckViewMode}
            readOnly={data().readOnly}
          />
        )}
      </Show>
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
        </MenubarMenu>
      </Menubar>
      <Show when={isLogVisible()}>
        <Log />
      </Show>
    </div>
  );
}
