import { type Component, createEffect, createSignal, For, on } from 'solid-js';
import { subscribePlayerLifeDeltaFlash } from '../playerLifeDeltaFlash';
import { playLifeChangeSound } from '../sounds';
import styles from './lifeChangeFlash.module.css';

type Floater = { id: number; delta: number; x: number; y: number; driftX: number };

let floaterId = 0;

const FLOAT_DURATION_MS = 920;

function randomFloaterOffset() {
  const angle = Math.random() * Math.PI * 2;
  const radius = 10 + Math.random() * 22;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.65,
    driftX: (Math.random() - 0.5) * 28,
  };
}

function pushFloater(
  setFloaters: (fn: (prev: Floater[]) => Floater[]) => void,
  delta: number,
  playSound: boolean,
) {
  if (!delta) return;
  if (playSound) playLifeChangeSound(delta);
  const id = ++floaterId;
  const { x, y, driftX } = randomFloaterOffset();
  setFloaters(prev => [...prev, { id, delta, x, y, driftX }]);
  window.setTimeout(() => {
    setFloaters(prev => prev.filter(entry => entry.id !== id));
  }, FLOAT_DURATION_MS);
}

export function useLifeDeltaFlash(playSound = true) {
  const [floaters, setFloaters] = createSignal<Floater[]>([]);
  const showDelta = (delta: number) => pushFloater(setFloaters, delta, playSound);
  return { floaters, showDelta };
}

export const LifeDeltaLayer: Component<{ floaters: Floater[] }> = props => (
  <For each={props.floaters}>
    {entry => (
      <span
        class={`${styles.delta} ${entry.delta > 0 ? styles.deltaGain : styles.deltaLoss}`}
        style={{
          '--life-delta-x': `${entry.x}px`,
          '--life-delta-y': `${entry.y}px`,
          '--life-delta-drift-x': `${entry.driftX}px`,
        }}
        aria-hidden='true'>
        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
      </span>
    )}
  </For>
);

/** Wraps a life readout and flashes +/- when `value` changes. */
export const LifeReadoutWithDelta: Component<{
  value: number;
  title: string;
  class?: string;
  playSound?: boolean;
  /** Skip +/- flash (e.g. your row on the right list while you edit life on the left). */
  showDeltaFlash?: boolean;
  /** Play-area seat id — uses awareness sync for multiplayer +/- flashes. */
  seatClientId?: number;
}> = props => {
  const playSound = () => props.playSound !== false;
  const showDeltaFlash = () => props.showDeltaFlash !== false;
  const { floaters, showDelta } = useLifeDeltaFlash(playSound());

  subscribePlayerLifeDeltaFlash(props.seatClientId, showDeltaFlash, showDelta);

  createEffect(
    on(
      () => props.value,
      (value, previous) => {
        if (props.seatClientId !== undefined) return;
        if (!showDeltaFlash()) return;
        if (previous !== undefined && value !== previous) {
          showDelta(value - previous);
        }
      },
      { defer: true },
    ),
  );

  return (
    <div class={`${styles.shell} ${props.class ?? ''}`} title={props.title}>
      {props.value}
      <LifeDeltaLayer floaters={floaters()} />
    </div>
  );
};
