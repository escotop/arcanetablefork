import CoinsIcon from 'lucide-solid/icons/coins';
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left';
import ChevronRightIcon from 'lucide-solid/icons/chevron-right';
import Dice6Icon from 'lucide-solid/icons/dice-6';
import { Component, createSignal, onCleanup, Show } from 'solid-js';
import { cn } from '~/lib/utils';
import { createCoinFlipEvent, createDieRollEvent } from '../createEvents';
import { sendEvent } from '../globals';
import { playCoinFlipSound, playDiceRollSound } from '../sounds';
import D20Icon from './icons/d20Icon';
import styles from './randomToolsPanel.module.css';

const FLASH_DURATION_MS = 2400;

type FlashState = {
  id: number;
  label: string;
};

const RandomToolsPanel: Component = () => {
  const [expanded, setExpanded] = createSignal(false);
  const [flash, setFlash] = createSignal<FlashState | null>(null);
  let flashSeq = 0;
  let flashTimeout: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (flashTimeout) clearTimeout(flashTimeout);
  });

  function showFlash(label: string) {
    flashSeq += 1;
    const id = flashSeq;
    setFlash({ id, label });
    if (flashTimeout) clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => {
      setFlash(current => (current?.id === id ? null : current));
    }, FLASH_DURATION_MS);
  }

  function flipCoin() {
    const heads = Math.random() < 0.5;
    const result = heads ? 'heads' : 'tails';
    const label = heads ? 'Heads' : 'Tails';
    playCoinFlipSound();
    showFlash(label);
    sendEvent(createCoinFlipEvent(result));
  }

  function rollDie(sides: 6 | 20) {
    const result = Math.floor(Math.random() * sides) + 1;
    playDiceRollSound();
    showFlash(String(result));
    sendEvent(createDieRollEvent(sides, result));
  }

  return (
    <div class={styles.root} aria-label='Random tools'>
      <Show when={flash()} keyed>
        {current => (
          <div class={styles.flashResult} aria-live='polite'>
            {current.label}
          </div>
        )}
      </Show>

      <button
        type='button'
        class={cn(styles.toggleTab, expanded() && styles.toggleTabExpanded)}
        aria-expanded={expanded()}
        aria-label={expanded() ? 'Collapse random tools' : 'Expand random tools'}
        onClick={() => setExpanded(value => !value)}>
        {expanded() ? <ChevronRightIcon class='size-3.5' /> : <ChevronLeftIcon class='size-3.5' />}
      </button>

      <div class={cn(styles.panel, !expanded() && styles.panelCollapsed)}>
        <button
          type='button'
          class={styles.toolButton}
          aria-label='Flip a coin'
          title='Flip a coin'
          onClick={flipCoin}>
          <CoinsIcon />
        </button>
        <button
          type='button'
          class={styles.toolButton}
          aria-label='Roll a six-sided die'
          title='Roll d6'
          onClick={() => rollDie(6)}>
          <Dice6Icon />
        </button>
        <button
          type='button'
          class={styles.toolButton}
          aria-label='Roll a twenty-sided die'
          title='Roll d20'
          onClick={() => rollDie(20)}>
          <D20Icon class='size-[1.1rem]' />
        </button>
      </div>
    </div>
  );
};

export default RandomToolsPanel;
