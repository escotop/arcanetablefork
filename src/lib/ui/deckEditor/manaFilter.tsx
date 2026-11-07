import { Component, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import CheckIcon from 'lucide-solid/icons/check';
import BanIcon from 'lucide-solid/icons/ban';
import { cn } from '~/lib/cnUtil';
import {
  MANA_COLORS,
  type ManaBucket,
  type ManaFilterMode,
} from '~/lib/manaCost';

const MANA_OPTIONS: ManaBucket[] = ['W', 'U', 'B', 'R', 'G', 'C'];

const MODE_OPTIONS: { mode: ManaFilterMode; label: string; hint: string }[] = [
  { mode: 'or', label: 'OR', hint: 'Cards with any of the selected colors' },
  { mode: 'and', label: 'AND', hint: 'Cards with all the selected colors at once' },
];

interface Props {
  /** Colors the card must contain (combined with `mode`). */
  value: ManaBucket[];
  /** Colors the card must not contain. */
  excluded: ManaBucket[];
  onChange(value: ManaBucket[], excluded: ManaBucket[]): void;
  mode: ManaFilterMode;
  onModeChange(mode: ManaFilterMode): void;
}

function ManaOptionLabel(props: { bucket: ManaBucket; excluded?: boolean }) {
  const style = MANA_COLORS[props.bucket];
  return (
    <span
      class={cn(
        'relative inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none shadow-sm ring-1 ring-black/10',
        props.excluded && 'opacity-60 ring-2 ring-destructive',
      )}
      style={{
        background: style.color,
        color: style.textColor,
      }}
      aria-hidden='true'>
      {props.bucket}
      <Show when={props.excluded}>
        <span class='absolute left-1/2 top-1/2 h-0.5 w-6 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded bg-destructive' />
      </Show>
    </span>
  );
}

const ManaFilter: Component<Props> = props => {
  const [open, setOpen] = createSignal(false);
  const [anchorRect, setAnchorRect] = createSignal<DOMRect>();
  let rootRef: HTMLDivElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  let ignoreOutsideClose = false;

  const selectedOptions = createMemo(() =>
    props.value.filter(option => MANA_OPTIONS.includes(option)),
  );
  const excludedOptions = createMemo(() =>
    props.excluded.filter(option => MANA_OPTIONS.includes(option)),
  );
  const activeCount = () => selectedOptions().length + excludedOptions().length;

  function stateOf(bucket: ManaBucket): 'none' | 'include' | 'exclude' {
    if (props.value.includes(bucket)) return 'include';
    if (props.excluded.includes(bucket)) return 'exclude';
    return 'none';
  }

  function updateAnchorRect() {
    if (!rootRef) return;
    setAnchorRect(rootRef.getBoundingClientRect());
  }

  function openDropdown() {
    updateAnchorRect();
    setOpen(true);
  }

  function closeDropdown() {
    setOpen(false);
  }

  function keepOpenThroughPointer(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    ignoreOutsideClose = true;
    window.setTimeout(() => {
      ignoreOutsideClose = false;
    }, 0);
  }

  /** Each click cycles: off → contains → doesn't contain → off. */
  function cycleMana(bucket: ManaBucket, event: Event) {
    keepOpenThroughPointer(event);

    const include = props.value.filter(value => value !== bucket);
    const exclude = props.excluded.filter(value => value !== bucket);
    const state = stateOf(bucket);
    if (state === 'none') include.push(bucket);
    else if (state === 'include') exclude.push(bucket);
    props.onChange(include, exclude);

    setOpen(true);
  }

  createEffect(() => {
    if (!open()) return;
    updateAnchorRect();
    const onLayoutChange = () => updateAnchorRect();
    window.addEventListener('resize', onLayoutChange);
    window.addEventListener('scroll', onLayoutChange, true);
    onCleanup(() => {
      window.removeEventListener('resize', onLayoutChange);
      window.removeEventListener('scroll', onLayoutChange, true);
    });
  });

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ignoreOutsideClose) return;
      const target = event.target as Node;
      if (rootRef?.contains(target) || menuRef?.contains(target)) return;
      closeDropdown();
    };
    document.addEventListener('pointerdown', onPointerDown);
    onCleanup(() => document.removeEventListener('pointerdown', onPointerDown));
  });

  const menuContent = () => (
    <>
      <div class='mb-1 flex gap-1 rounded-sm bg-muted p-0.5' role='radiogroup' aria-label='Match mode'>
        <For each={MODE_OPTIONS}>
          {option => (
            <button
              type='button'
              role='radio'
              aria-checked={props.mode === option.mode}
              title={option.hint}
              class={cn(
                'flex-1 rounded-sm px-2 py-1 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground',
                props.mode === option.mode && 'bg-background text-foreground shadow-sm',
              )}
              onPointerDown={event => {
                keepOpenThroughPointer(event);
                props.onModeChange(option.mode);
                setOpen(true);
              }}>
              {option.label}
            </button>
          )}
        </For>
      </div>
      <div class='mb-1 px-2 text-[11px] leading-tight text-muted-foreground'>
        {MODE_OPTIONS.find(option => option.mode === props.mode)?.hint}
        <br />
        Click again to exclude a color. Lands: mana they produce.
      </div>
      <For each={MANA_OPTIONS}>
        {bucket => (
          <button
            type='button'
            class={cn(
              'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground',
              stateOf(bucket) === 'include' && 'bg-accent/50',
              stateOf(bucket) === 'exclude' && 'bg-destructive/10',
            )}
            onPointerDown={event => cycleMana(bucket, event)}>
            <span class='absolute left-2 flex size-3.5 items-center justify-center'>
              <Show when={stateOf(bucket) === 'include'}>
                <CheckIcon class='size-4' />
              </Show>
              <Show when={stateOf(bucket) === 'exclude'}>
                <BanIcon class='size-4 text-destructive' />
              </Show>
            </span>
            <ManaOptionLabel bucket={bucket} excluded={stateOf(bucket) === 'exclude'} />
            <span class='flex-1 text-muted-foreground'>{bucket === 'C' ? 'Colorless' : bucket}</span>
            <span class='text-[10px] text-muted-foreground'>
              {stateOf(bucket) === 'include'
                ? 'contains'
                : stateOf(bucket) === 'exclude'
                  ? 'excludes'
                  : ''}
            </span>
          </button>
        )}
      </For>
    </>
  );

  return (
    <div
      ref={rootRef}
      class={cn(
        'flex h-9 w-[7.5rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-transparent px-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        open() && 'ring-2 ring-ring ring-offset-2',
      )}
      role='button'
      tabIndex={0}
      aria-haspopup='listbox'
      aria-expanded={open()}
      onPointerDown={event => {
        event.preventDefault();
        openDropdown();
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDropdown();
        }
        if (event.key === 'Escape' && open()) {
          event.preventDefault();
          closeDropdown();
        }
      }}>
      <Show
        when={activeCount() > 0}
        fallback={<span class='min-w-0 flex-1 truncate text-muted-foreground'>Mana</span>}>
        <div class='flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden'>
          <For each={selectedOptions()}>
            {bucket => <ManaOptionLabel bucket={bucket} />}
          </For>
          <For each={excludedOptions()}>
            {bucket => <ManaOptionLabel bucket={bucket} excluded />}
          </For>
        </div>
      </Show>
      <Show when={selectedOptions().length > 0}>
        <span
          class='shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground'
          title={props.mode === 'and' ? 'All selected colors' : 'Any selected color'}>
          {selectedOptions().length > 1 ? (props.mode === 'and' ? 'AND' : 'OR') : selectedOptions().length}
        </span>
      </Show>
      <svg
        xmlns='http://www.w3.org/2000/svg'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
        stroke-linecap='round'
        stroke-linejoin='round'
        class='size-4 shrink-0 opacity-50'
        aria-hidden='true'>
        <path d='M8 9l4 -4l4 4' />
        <path d='M16 15l-4 4l-4 -4' />
      </svg>
      <Portal>
        <Show when={open() && anchorRect()}>
          <div
            ref={menuRef}
            class='fixed z-[100] min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80'
            style={{
              top: `${anchorRect()!.bottom + 4}px`,
              left: `${anchorRect()!.left}px`,
            }}
            onPointerDownCapture={() => {
              ignoreOutsideClose = true;
              window.setTimeout(() => {
                ignoreOutsideClose = false;
              }, 0);
            }}
            onPointerDown={event => event.stopPropagation()}>
            {menuContent()}
          </div>
        </Show>
      </Portal>
    </div>
  );
};

export default ManaFilter;
