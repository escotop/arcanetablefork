import { Show } from 'solid-js';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import {
  eventCatchUpCompleteSignal,
  isHistoricalLogReplayInProgress,
  isInitialized,
  isSyncPaused,
} from '../globals';
import { multiplayerBlockState } from '../multiplayerSync';

export default function MultiplayerSyncOverlay() {
  const state = () => multiplayerBlockState();
  const catchUpReady = () => eventCatchUpCompleteSignal();
  const showOverlay = () =>
    isInitialized() &&
    (state().blocked || isSyncPaused() || (!catchUpReady() && isHistoricalLogReplayInProgress()));

  const message = () => {
    if (state().blocked && state().message) return state().message;
    if (isSyncPaused()) return 'Sync paused…';
    if (!catchUpReady()) return 'Synchronizing game log…';
    return 'Synchronizing…';
  };

  return (
    <Show when={showOverlay()}>
      <div class='fixed inset-0 z-[1500] flex flex-col items-center justify-center gap-3 bg-black/45 pointer-events-auto'>
        <LoaderIcon class='size-10 text-white animate-spin' />
        <p class='text-base font-semibold text-white'>{message()}</p>
      </div>
    </Show>
  );
}
