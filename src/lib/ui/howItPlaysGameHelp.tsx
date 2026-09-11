import { Component, Show, createEffect, createSignal, onCleanup } from 'solid-js';
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

interface Props {
  playArea?: PlayArea;
}

const HowItPlaysGameHelp: Component<Props> = props => {
  const section = () => howItPlaysAdvice();
  const [helpClicked, setHelpClicked] = createSignal(false);
  let panelRef: HTMLDivElement | undefined;
  let helpButtonRef: HTMLButtonElement | undefined;

  const handCards = () => {
    howItPlaysHandTick();
    howItPlaysMulliganTick();
    return [...(props.playArea?.hand.cards ?? [])];
  };

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
            <div class={styles.howItPlaysModalBody}>
              <h3 class='text-sm font-semibold'>How it plays</h3>
              <HowItPlaysContent section={section()!} handCards={handCards} class='mt-2' />
            </div>
            <Show when={props.playArea}>
              <div class={styles.howItPlaysModalFooter}>
                <Button
                  type='button'
                  variant='outline'
                  class={styles.howItPlaysMulliganButton}
                  onClick={() => void mulliganToSeven()}>
                  Mulligan to 7
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
};

export default HowItPlaysGameHelp;
