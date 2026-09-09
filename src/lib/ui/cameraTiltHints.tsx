import { Component, Show } from 'solid-js';
import { activateCameraTilt, cameraTiltHints } from '../cameraTilt';
import styles from './overlay.module.css';
import ChevronLeftIcon from 'lucide-solid/icons/chevron-left';
import ChevronRightIcon from 'lucide-solid/icons/chevron-right';
import ChevronUpIcon from 'lucide-solid/icons/chevron-up';

const stopPropagation = (event: MouseEvent) => {
  event.stopPropagation();
  event.preventDefault();
};

const CameraTiltHints: Component = () => {
  return (
    <>
      <Show when={cameraTiltHints().left}>
        <button
          type='button'
          class={`${styles.cameraTiltHint} ${styles.cameraTiltHintLeft}`}
          title='Tilt camera left'
          aria-label='Tilt camera left'
          onPointerDown={stopPropagation}
          onClick={event => {
            stopPropagation(event);
            activateCameraTilt('left');
          }}>
          <ChevronLeftIcon class={styles.cameraTiltHintIcon} stroke-width={1.5} />
        </button>
      </Show>
      <Show when={cameraTiltHints().right}>
        <button
          type='button'
          class={`${styles.cameraTiltHint} ${styles.cameraTiltHintRight}`}
          title='Tilt camera right'
          aria-label='Tilt camera right'
          onPointerDown={stopPropagation}
          onClick={event => {
            stopPropagation(event);
            activateCameraTilt('right');
          }}>
          <ChevronRightIcon class={styles.cameraTiltHintIcon} stroke-width={1.5} />
        </button>
      </Show>
      <Show when={cameraTiltHints().top}>
        <button
          type='button'
          class={`${styles.cameraTiltHint} ${styles.cameraTiltHintTop}`}
          title='Tilt camera up'
          aria-label='Tilt camera up'
          onPointerDown={stopPropagation}
          onClick={event => {
            stopPropagation(event);
            activateCameraTilt('top');
          }}>
          <ChevronUpIcon class={styles.cameraTiltHintIcon} stroke-width={1.5} />
        </button>
      </Show>
    </>
  );
};

export default CameraTiltHints;
