import { Component, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import CheckIcon from 'lucide-solid/icons/check';
import { cn } from '~/lib/cnUtil';
import {
  MANA_COLORS,
  type ManaBucket,
} from '~/lib/manaCost';

const MANA_OPTIONS: ManaBucket[] = ['W', 'U', 'B', 'R', 'G', 'C'];

interface Props {
  value: ManaBucket[];
  onChange(value: ManaBucket[]): void;
}

function ManaOptionLabel(props: { bucket: ManaBucket }) {
  const style = MANA_COLORS[props.bucket];
  return (
    <span
      class='inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none shadow-sm ring-1 ring-black/10'
      style={{
        background: style.color,
        color: style.textColor,
      }}
      aria-hidden='true'>
      {props.bucket}
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

  const unselectedOptions = createMemo(() =>
    MANA_OPTIONS.filter(option => !props.value.includes(option)),
  );

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

  function toggleMana(bucket: ManaBucket, event: Event) {
    keepOpenThroughPointer(event);

    if (props.value.includes(bucket)) {
      props.onChange(props.value.filter(value => value !== bucket));
    } else {
      props.onChange([...props.value, bucket]);
    }

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
      <For each={selectedOptions()}>
        {bucket => (
          <button
            type='button'
            class='relative flex w-full cursor-default select-none items-center gap-2 rounded-sm bg-accent/50 py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground'
            onPointerDown={event => toggleMana(bucket, event)}>
            <span class='absolute left-2 flex size-3.5 items-center justify-center'>
              <CheckIcon class='size-4' />
            </span>
            <ManaOptionLabel bucket={bucket} />
            <span class='text-muted-foreground'>{bucket === 'C' ? 'Colorless' : bucket}</span>
          </button>
        )}
      </For>
      <Show when={selectedOptions().length > 0 && unselectedOptions().length > 0}>
        <div class='my-1 border-t border-border' />
      </Show>
      <For each={unselectedOptions()}>
        {bucket => (
          <button
            type='button'
            class='relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground'
            onPointerDown={event => toggleMana(bucket, event)}>
            <span class='absolute left-2 flex size-3.5 items-center justify-center opacity-0'>
              <CheckIcon class='size-4' />
            </span>
            <ManaOptionLabel bucket={bucket} />
            <span class='text-muted-foreground'>{bucket === 'C' ? 'Colorless' : bucket}</span>
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
        when={selectedOptions().length > 0}
        fallback={<span class='min-w-0 flex-1 truncate text-muted-foreground'>Mana</span>}>
        <div class='flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden'>
          <For each={selectedOptions()}>
            {bucket => <ManaOptionLabel bucket={bucket} />}
          </For>
        </div>
      </Show>
      <Show when={selectedOptions().length > 0}>
        <span class='shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground'>
          {selectedOptions().length}
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
