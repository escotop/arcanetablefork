import {
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogFooter,
  Dialog,
} from '~/components/ui/dialog';
import { MenubarItem } from '~/components/ui/menubar';
import {
  FOCUS_PANEL_MAX_SCALE,
  FOCUS_PANEL_MIN_SCALE,
  players,
  provider,
  setSettings,
  settings,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  SOUND_VOLUME_STEP,
  updateFocusPanelSize,
} from '../globals';
import { devLog } from '../devLog';
import { Label } from '~/components/ui/label';
import { Checkbox } from '~/components/ui/checkbox';
import { Button } from '~/components/ui/button';
import CopyLinkButton from '~/components/ui/copy-link-button';
import {
  Slider,
  SliderFill,
  SliderLabel,
  SliderThumb,
  SliderTrack,
  SliderValueLabel,
} from '~/components/ui/slider';
import { useParams } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { resolvePlayerColor, syncLocalPlayerColor } from '../playerColor';
import { playTapSound } from '../sounds';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';
import { toast } from 'solid-sonner';
import {
  downloadGameStateExport,
  importGameState,
  parseGameStateSnapshot,
} from '../gameStateSnapshot';
import {
  getLocalPlayerClientId,
  kickPlayer,
  playAreas,
} from '../globals';
import { getPlayAreaPlayerName } from '../playAreaNameTag';

export default function SettingsOverlay(props: {
  isOpen: boolean;
  onClose(): void;
  onOpen(): void;
}) {
  const params = useParams();
  const [importConfirmOpen, setImportConfirmOpen] = createSignal(false);
  const [pendingImport, setPendingImport] = createSignal<File | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [kickConfirmOpen, setKickConfirmOpen] = createSignal(false);
  const [pendingKick, setPendingKick] = createSignal<{ clientId: number; name: string } | null>(
    null,
  );
  const localPlayer = () =>
    players().find(player => player.id === provider?.awareness?.clientID)?.entry;
  const playerColor = () =>
    settings.playerColor ?? resolvePlayerColor(localPlayer());

  const tablePlayers = () =>
    Object.values(playAreas)
      .filter(Boolean)
      .map(playArea => ({
        clientId: playArea.clientId,
        name: getPlayAreaPlayerName(playArea),
        isLocal: playArea.isLocalPlayArea || playArea.clientId === getLocalPlayerClientId(),
      }))
      .sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name));

  function setPlayerColor(color: string) {
    setSettings('playerColor', color);
    syncLocalPlayerColor(color);
  }

  function handleExportGameState() {
    try {
      downloadGameStateExport(params.gameId);
      toast.success('Game state exported');
    } catch (error) {
      devLog.error(error);
      toast.error('Failed to export game state');
    }
  }

  function handleImportFileSelected(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setPendingImport(file);
    setImportConfirmOpen(true);
  }

  async function confirmImportGameState() {
    const file = pendingImport();
    const gameId = params.gameId;
    if (!file || !gameId) return;

    setImporting(true);
    try {
      const text = await file.text();
      const snapshot = parseGameStateSnapshot(JSON.parse(text));
      await importGameState(snapshot, gameId);
      setImportConfirmOpen(false);
      setPendingImport(null);
      toast.success('Game state imported');
      props.onClose();
    } catch (error) {
      devLog.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to import game state');
    } finally {
      setImporting(false);
    }
  }

  function requestKickPlayer(clientId: number, name: string) {
    if (clientId === getLocalPlayerClientId()) return;
    setPendingKick({ clientId, name });
    setKickConfirmOpen(true);
  }

  function confirmKickPlayer() {
    const target = pendingKick();
    const gameId = params.gameId;
    if (!target || !gameId) return;

    kickPlayer(target.clientId, gameId);
    setKickConfirmOpen(false);
    setPendingKick(null);
    toast.success(`${target.name} was removed from the game`);
  }

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={isOpen => (isOpen ? props.onOpen() : props.onClose())}>
      <DialogTrigger as={MenubarItem} class='w-full'>
        Settings
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>Settings</DialogHeader>
        <DialogDescription>
          <Label class='flex items-baseline space-x-2'>
            <Checkbox
              id='camera-tilt'
              checked={settings.enableCameraTilt}
              onChange={checked => setSettings('enableCameraTilt', checked)}
            />
            <span>Enable Camera Tilt </span>
          </Label>
          <Slider
            class='mt-4'
            minValue={FOCUS_PANEL_MIN_SCALE}
            maxValue={FOCUS_PANEL_MAX_SCALE}
            step={0.05}
            value={[settings.focusPanelScale]}
            onChange={([scale]) => {
              setSettings('focusPanelScale', scale);
              updateFocusPanelSize(scale);
            }}>
            <div class='flex gap-4 w-full mb-2'>
              <SliderLabel>Card preview size</SliderLabel>
              <SliderValueLabel />
            </div>
            <SliderTrack>
              <SliderFill />
              <SliderThumb />
            </SliderTrack>
          </Slider>
          <Slider
            class='mt-4'
            minValue={SOUND_VOLUME_MIN}
            maxValue={SOUND_VOLUME_MAX}
            step={SOUND_VOLUME_STEP}
            value={[settings.localSoundVolume]}
            onChange={([volume]) => {
              setSettings('localSoundVolume', volume);
              playTapSound(false, { preview: true });
            }}>
            <div class='flex gap-4 w-full mb-2'>
              <SliderLabel>Your sound volume</SliderLabel>
              <SliderValueLabel />
            </div>
            <SliderTrack>
              <SliderFill />
              <SliderThumb />
            </SliderTrack>
          </Slider>
          <Slider
            class='mt-4'
            minValue={SOUND_VOLUME_MIN}
            maxValue={SOUND_VOLUME_MAX}
            step={SOUND_VOLUME_STEP}
            value={[settings.remoteSoundVolume]}
            onChange={([volume]) => {
              setSettings('remoteSoundVolume', volume);
              playTapSound(true, { preview: true });
            }}>
            <div class='flex gap-4 w-full mb-2'>
              <SliderLabel>Other players&apos; sound volume</SliderLabel>
              <SliderValueLabel />
            </div>
            <SliderTrack>
              <SliderFill />
              <SliderThumb />
            </SliderTrack>
          </Slider>
          <div class='mt-4 space-y-2'>
            <Label for='player-color'>Player color</Label>
            <div class='flex items-center gap-3'>
              <input
                id='player-color'
                type='color'
                value={playerColor()}
                onInput={e => setPlayerColor(e.currentTarget.value)}
                class='h-10 w-14 cursor-pointer rounded border border-input bg-transparent p-1'
              />
              <span class='text-sm text-muted-foreground font-mono'>{playerColor()}</span>
            </div>
          </div>
          <Show when={params.gameId}>
            <div class='mt-4 space-y-2'>
              <Label>Players</Label>
              <Show
                when={tablePlayers().length > 0}
                fallback={<p class='text-sm text-muted-foreground'>No players at the table yet.</p>}>
                <ul class='space-y-2'>
                  <For each={tablePlayers()}>
                    {player => (
                      <li class='flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2'>
                        <div class='min-w-0'>
                          <p class='truncate text-sm font-medium'>
                            {player.name}
                            {player.isLocal ? ' (you)' : ''}
                          </p>
                        </div>
                        <Show when={!player.isLocal}>
                          <Button
                            type='button'
                            variant='destructive'
                            size='sm'
                            onClick={() => requestKickPlayer(player.clientId, player.name)}>
                            Kick
                          </Button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
            <div class='mt-4 space-y-2'>
              <Label>Game state</Label>
              <p class='text-sm text-muted-foreground'>
                Save or restore card positions, decks, and player stats for this table.
              </p>
              <div class='flex gap-2'>
                <Button type='button' variant='outline' size='sm' onClick={handleExportGameState}>
                  Export
                </Button>
                <Button type='button' variant='outline' size='sm' as='label' class='cursor-pointer'>
                  Import
                  <input
                    type='file'
                    accept='application/json,.json'
                    class='sr-only'
                    onChange={handleImportFileSelected}
                  />
                </Button>
              </div>
            </div>
            <div class='mt-4 space-y-2'>
              <Label for='invite-code'>Invite code</Label>
              <div class='flex gap-2'>
                <input
                  id='invite-code'
                  type='text'
                  readonly
                  value={params.gameId}
                  class='flex h-10 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono ring-offset-background select-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                />
                <CopyLinkButton text={params.gameId} variant='outline' size='sm'>
                  Copy
                </CopyLinkButton>
              </div>
              <CopyLinkButton variant='ghost' size='sm' class='px-0'>
                Copy invite link
              </CopyLinkButton>
            </div>
          </Show>
        </DialogDescription>
        <DialogFooter>
          <Button onClick={props.onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={importConfirmOpen()} onOpenChange={setImportConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Import game state?</AlertDialogTitle>
          <AlertDialogDescription>
            This replaces the current table state for everyone connected to this game. Card
            positions, decks, and player stats will be overwritten.
          </AlertDialogDescription>
          <div class='mt-4 flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={importing()}
              onClick={() => {
                setImportConfirmOpen(false);
                setPendingImport(null);
              }}>
              Cancel
            </Button>
            <Button type='button' disabled={importing()} onClick={confirmImportGameState}>
              {importing() ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={kickConfirmOpen()} onOpenChange={setKickConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>Kick {pendingKick()?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove them from the game and clear their board. If they rejoin using the
            invite link, they will start fresh as a new player.
          </AlertDialogDescription>
          <div class='mt-4 flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setKickConfirmOpen(false);
                setPendingKick(null);
              }}>
              Cancel
            </Button>
            <Button type='button' variant='destructive' onClick={confirmKickPlayer}>
              Kick player
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
