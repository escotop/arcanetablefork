import { Show } from 'solid-js';
import LoaderIcon from 'lucide-solid/icons/loader-circle';
import { isInitialized } from '../globals';
import { multiplayerBlockState } from '../multiplayerSync';

export default function MultiplayerSyncOverlay() {
  const state = () => multiplayerBlockState();

  return (
    <Show when={isInitialized() && state().blocked}>
      <div class='fixed inset-0 z-[1500] flex flex-col items-center justify-center gap-3 bg-black/45 pointer-events-auto'>
        <LoaderIcon class='size-10 text-white animate-spin' />
        <p class='text-base font-semibold text-white'>{state().message}</p>
      </div>
    </Show>
  );
}
