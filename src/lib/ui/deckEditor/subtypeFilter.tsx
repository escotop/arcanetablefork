import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import CheckIcon from 'lucide-solid/icons/check';
import { cn } from '~/lib/cnUtil';

interface Props {
  options: string[];
  value: string[];
  onChange(value: string[]): void;
  /** Render menu inside the trigger (for dialogs/modals). */
  inlineMenu?: boolean;
}

const SubtypeFilter: Component<Props> = props => {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [anchorRect, setAnchorRect] = createSignal<DOMRect>();
  let rootRef: HTMLDivElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let ignoreOutsideClose = false;

  const useInlineMenu = () => props.inlineMenu ?? false;

  const selectedOptions = createMemo(() =>
    props.value.filter(option => props.options.includes(option)),
  );

  const listSections = createMemo(() => {
    const search = query().trim().toLowerCase();
    const selected = selectedOptions();
    const unselected = props.options.filter(option => !props.value.includes(option));
    const matchesSearch = (option: string) =>
      !search || option.toLowerCase().includes(search);

    return {
      selected,
      unselected: unselected.filter(matchesSearch),
    };
  });

  function updateAnchorRect() {
    if (!rootRef || useInlineMenu()) return;
    setAnchorRect(rootRef.getBoundingClientRect());
  }

  function openDropdown() {
    updateAnchorRect();
    setOpen(true);
    queueMicrotask(() => inputRef?.focus());
  }

  function closeDropdown() {
    setOpen(false);
    setQuery('');
  }

  function toggleSubtype(subtype: string, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    ignoreOutsideClose = true;

    if (props.value.includes(subtype)) {
      props.onChange(props.value.filter(value => value !== subtype));
    } else {
      props.onChange([...props.value, subtype]);
    }

    setOpen(true);
    queueMicrotask(() => {
      inputRef?.focus();
      ignoreOutsideClose = false;
    });
  }

  createEffect(() => {
    if (!open() || useInlineMenu()) return;
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
      <For each={listSections().selected}>
        {option => (
          <button
            type='button'
            class='relative flex w-full cursor-default select-none items-center rounded-sm bg-accent/50 py-1.5 pl-8 pr-2 text-left text-sm font-medium outline-none hover:bg-accent hover:text-accent-foreground'
            onPointerDown={event => toggleSubtype(option, event)}>
            <span class='absolute left-2 flex size-3.5 items-center justify-center'>
              <CheckIcon class='size-4' />
            </span>
            {option}
          </button>
        )}
      </For>
      <Show when={listSections().selected.length > 0 && listSections().unselected.length > 0}>
        <div class='my-1 border-t border-border' />
      </Show>
      <For each={listSections().unselected}>
        {option => (
          <button
            type='button'
            class='relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground'
            onPointerDown={event => toggleSubtype(option, event)}>
            <span class='absolute left-2 flex size-3.5 items-center justify-center opacity-0'>
              <CheckIcon class='size-4' />
            </span>
            {option}
          </button>
        )}
      </For>
      <Show when={listSections().selected.length === 0 && listSections().unselected.length === 0}>
        <div class='px-2 py-3 text-center text-sm text-muted-foreground'>No results</div>
      </Show>
    </>
  );

  return (
    <Show when={props.options.length > 0}>
      <div
        ref={rootRef}
        class={cn(
          'flex h-9 w-40 shrink-0 cursor-text items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          useInlineMenu() && 'relative',
          open() && 'ring-2 ring-ring ring-offset-2',
        )}
        onPointerDown={event => {
          if (event.target === inputRef) return;
          openDropdown();
        }}>
        <input
          ref={inputRef}
          type='text'
          class='min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-muted-foreground'
          placeholder='Subtype'
          value={query()}
          onInput={event => {
            setQuery(event.currentTarget.value);
            openDropdown();
          }}
          onFocus={() => openDropdown()}
        />
        <Show when={selectedOptions().length > 0 && !query()}>
          <span class='shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'>
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
        <Show when={useInlineMenu() && open()}>
          <div
            ref={menuRef}
            class='absolute left-0 top-full z-[100] mt-1 max-h-[40vh] w-full min-w-[11rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80'
            onPointerDown={event => event.stopPropagation()}>
            {menuContent()}
          </div>
        </Show>
      </div>
      <Show when={!useInlineMenu()}>
        <Portal>
          <Show when={open() && anchorRect()}>
            <div
              ref={menuRef}
              class='fixed z-[100] max-h-[40vh] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80'
              style={{
                top: `${anchorRect()!.bottom + 4}px`,
                left: `${anchorRect()!.left}px`,
                width: `${Math.max(anchorRect()!.width, 176)}px`,
              }}
              onPointerDown={event => event.stopPropagation()}>
              {menuContent()}
            </div>
          </Show>
        </Portal>
      </Show>
    </Show>
  );
};

export default SubtypeFilter;
