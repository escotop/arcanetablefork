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
}

function sortOptionsWithSelectedFirst(options: string[], selected: string[]) {
  const selectedSet = new Set(selected);
  const selectedInOrder = selected.filter(option => options.includes(option));
  const unselected = options.filter(option => !selectedSet.has(option));
  return [...selectedInOrder, ...unselected];
}

const SubtypeFilter: Component<Props> = props => {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [anchorRect, setAnchorRect] = createSignal<DOMRect>();
  let rootRef: HTMLDivElement | undefined;
  let portalRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  const sortedOptions = createMemo(() => sortOptionsWithSelectedFirst(props.options, props.value));

  const filteredOptions = createMemo(() => {
    const search = query().trim().toLowerCase();
    if (!search) return sortedOptions();
    return sortedOptions().filter(option => option.toLowerCase().includes(search));
  });

  function updateAnchorRect() {
    if (!rootRef) return;
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
    if (props.value.includes(subtype)) {
      props.onChange(props.value.filter(value => value !== subtype));
    } else {
      props.onChange([...props.value, subtype]);
    }
    updateAnchorRect();
    queueMicrotask(() => inputRef?.focus());
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
      const target = event.target as Node;
      if (rootRef?.contains(target) || portalRef?.contains(target)) return;
      closeDropdown();
    };
    document.addEventListener('pointerdown', onPointerDown);
    onCleanup(() => document.removeEventListener('pointerdown', onPointerDown));
  });

  return (
    <Show when={props.options.length > 0}>
      <div
        ref={rootRef}
        class={cn(
          'flex h-9 w-40 shrink-0 cursor-text items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          open() && 'ring-2 ring-ring ring-offset-2',
        )}
        onClick={() => openDropdown()}>
        <input
          ref={inputRef}
          type='text'
          class='min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground'
          placeholder='Subtype'
          value={query()}
          onInput={event => {
            setQuery(event.currentTarget.value);
            openDropdown();
          }}
          onFocus={() => openDropdown()}
        />
        <Show when={props.value.length > 0 && !query()}>
          <span class='shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'>
            {props.value.length}
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
      </div>
      <Portal>
        <Show when={open() && anchorRect()}>
          <div
            ref={portalRef}
            class='fixed z-[100] max-h-[40vh] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80'
            style={{
              top: `${anchorRect()!.bottom + 4}px`,
              left: `${anchorRect()!.left}px`,
              width: `${anchorRect()!.width}px`,
            }}
            onPointerDown={event => event.stopPropagation()}>
            <For each={filteredOptions()}>
              {option => (
                <button
                  type='button'
                  class={cn(
                    'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                    props.value.includes(option) && 'bg-accent/50',
                  )}
                  onPointerDown={event => toggleSubtype(option, event)}>
                  <span class='absolute left-2 flex size-3.5 items-center justify-center'>
                    <Show when={props.value.includes(option)}>
                      <CheckIcon class='size-4' />
                    </Show>
                  </span>
                  {option}
                </button>
              )}
            </For>
            <Show when={filteredOptions().length === 0}>
              <div class='px-2 py-3 text-center text-sm text-muted-foreground'>No results</div>
            </Show>
          </div>
        </Show>
      </Portal>
    </Show>
  );
};

export default SubtypeFilter;
