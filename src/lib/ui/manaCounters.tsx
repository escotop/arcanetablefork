import ChevronLeftIcon from 'lucide-solid/icons/chevron-left';
import ChevronRightIcon from 'lucide-solid/icons/chevron-right';
import { Component, For, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import styles from './manaCounters.module.css';

const MANA_COUNTERS = [
  { id: 'plains', label: 'White', icon: '/plains.png' },
  { id: 'island', label: 'Blue', icon: '/island.png' },
  { id: 'swamp', label: 'Black', icon: '/swamp.png' },
  { id: 'mountain', label: 'Red', icon: '/mountain.png' },
  { id: 'forest', label: 'Green', icon: '/forest.png' },
  { id: 'colorless', label: 'Colorless', icon: '/uncolor.png' },
] as const;

type ManaCounterId = (typeof MANA_COUNTERS)[number]['id'];

type ManaCounts = Record<ManaCounterId, number>;

const initialCounts = Object.fromEntries(MANA_COUNTERS.map(counter => [counter.id, 0])) as ManaCounts;

const ManaCounters: Component = () => {
  const [expanded, setExpanded] = createSignal(true);
  const [counts, setCounts] = createStore<ManaCounts>({ ...initialCounts });

  function adjust(id: ManaCounterId, delta: number) {
    setCounts(id, value => Math.max(0, value + delta));
  }

  function resetAll() {
    setCounts({ ...initialCounts });
  }

  return (
    <div class={styles.root} aria-label='Mana counters'>
      <button
        type='button'
        class={styles.toggleTab}
        aria-expanded={expanded()}
        aria-label={expanded() ? 'Collapse mana counters' : 'Expand mana counters'}
        onClick={() => setExpanded(value => !value)}>
        {expanded() ? <ChevronRightIcon class='size-3.5' /> : <ChevronLeftIcon class='size-3.5' />}
      </button>

      <div class={cn(styles.panel, !expanded() && styles.panelCollapsed)}>
        <For each={MANA_COUNTERS}>
          {counter => (
            <div class={styles.counter}>
              <span class={styles.count} aria-live='polite'>
                {counts[counter.id]}
              </span>
              <div class={styles.iconWrap}>
                <img class={styles.icon} src={counter.icon} alt={counter.label} draggable={false} />
              </div>
              <div class={styles.controls}>
                <Button
                  type='button'
                  variant='outline'
                  size='xsicon'
                  class={styles.adjustButton}
                  aria-label={`Decrease ${counter.label} mana`}
                  onClick={() => adjust(counter.id, -1)}>
                  −
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='xsicon'
                  class={styles.adjustButton}
                  aria-label={`Increase ${counter.label} mana`}
                  onClick={() => adjust(counter.id, 1)}>
                  +
                </Button>
              </div>
            </div>
          )}
        </For>
        <Button
          type='button'
          variant='outline'
          size='xsicon'
          class={styles.resetButton}
          aria-label='Reset all mana counters'
          onClick={resetAll}>
          <span class={styles.resetLabel}>Reset</span>
        </Button>
      </div>
    </div>
  );
};

export default ManaCounters;
