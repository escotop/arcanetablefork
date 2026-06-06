import { onCleanup, onMount, Show } from 'solid-js';
import { cleanup, isInitialized } from '~/lib/globals';
import { HotKeys } from '~/lib/shortcuts/hotkeys';
import StackTraceDialog from '~/lib/stack-trace-dialog';
import Overlay from '~/lib/ui/overlay';
import { localInit } from '~/main3d';

export default function TableViewPage() {
  onMount(() => {
    localInit({ gameId: 'test' });
  });

  onCleanup(() => {
    cleanup();
  });

  return (
    <>
      <Show when={isInitialized()}>
        <Overlay />
        <HotKeys />
      </Show>
      <StackTraceDialog />
    </>
  );
}
