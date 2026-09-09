import { Component, Show, createEffect, createSignal, on, onCleanup } from 'solid-js';
import CircleHelpIcon from 'lucide-solid/icons/circle-help';
import { Button } from '~/components/ui/button';
import {
  howItPlaysAdvice,
  howItPlaysHandTick,
  howItPlaysHelpVisible,
  howItPlaysModalOpen,
  howItPlaysMulliganTick,
  setHowItPlaysModalOpen,
} from '~/lib/globals';
import type { PlayArea } from '~/lib/playArea';
import HowItPlaysContent from './howItPlaysContent';
import styles from './overlay.module.css';

const MULLIGAN_MODAL_REFRESH_MS = 400;

interface Props {
  playArea?: PlayArea;
}

const HowItPlaysGameHelp: Component<Props> = props => {
  const section = () => howItPlaysAdvice();
  const [helpClicked, setHelpClicked] = createSignal(false);
  const [contentKey, setContentKey] = createSignal(0);
  let panelRef: HTMLDivElement | undefined;
  let helpButtonRef: HTMLButtonElement | undefined;
  let refreshTimer: number | undefined;

  const handCards = () => {
    howItPlaysHandTick();
    contentKey();
    return props.playArea?.hand.cards ?? [];
  };

  async function refreshModalAfterMulligan() {
    if (!howItPlaysModalOpen()) return;

    setHowItPlaysModalOpen(false);
    await new Promise<void>(resolve => {
      refreshTimer = window.setTimeout(resolve, MULLIGAN_MODAL_REFRESH_MS);
    });
    refreshTimer = undefined;

    if (howItPlaysHelpVisible() && section()) {
      setContentKey(key => key + 1);
      setHowItPlaysModalOpen(true);
    }
  }

  createEffect(
    on(howItPlaysMulliganTick, tick => {
      if (tick === 0 || !howItPlaysModalOpen()) return;
      void refreshModalAfterMulligan();
    }),
  );

  createEffect(() => {
    if (!howItPlaysModalOpen()) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef?.contains(target)) return;
      if (helpButtonRef?.contains(target)) return;
      setHowItPlaysModalOpen(false);
    }

    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDown);
    }, 0);

    onCleanup(() => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointerDown);
    });
  });

  onCleanup(() => {
    if (refreshTimer !== undefined) {
      window.clearTimeout(refreshTimer);
    }
  });

  async function mulliganToSeven() {
    await props.playArea?.mulligan(7);
  }

  function openHelp() {
    setHelpClicked(true);
    setHowItPlaysModalOpen(true);
  }

  return (
    <>
      <Show when={howItPlaysHelpVisible() && section()}>
        <button
          ref={helpButtonRef}
          type='button'
          classList={{
            [styles.howItPlaysHelpButton]: true,
            [styles.howItPlaysHelpButtonPending]: !helpClicked(),
          }}
          aria-label='Opening hand advice'
          title='Opening hand advice'
          onClick={openHelp}>
          <CircleHelpIcon class='size-6' />
        </button>
      </Show>

      <Show when={howItPlaysModalOpen() && section()}>
        <div class={styles.howItPlaysModalBackdrop}>
          <div ref={panelRef} class={styles.howItPlaysModalPanel}>
            <h3 class='text-sm font-semibold'>How it plays</h3>
            <HowItPlaysContent
              section={section()!}
              handCards={handCards}
              class='mt-2'
            />
            <Show when={props.playArea}>
              <Button type='button' class='mt-4 w-full' onClick={() => void mulliganToSeven()}>
                Mulligan to 7
              </Button>
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
};

export default HowItPlaysGameHelp;
