import { Component, For, JSX, Show } from 'solid-js';
import { Button } from '~/components/ui/button';
import { TextField, TextFieldInput } from '~/components/ui/text-field';
import { Deck } from '~/lib/constants';
import { getBracketColor, getBracketTagLabel } from '~/lib/commanderBracket';
import { getCommanderNames } from '~/lib/deckCommander';

export type BracketFilter = 'all' | 'none' | 1 | 2 | 3 | 4 | 5;

export const BRACKET_FILTER_OPTIONS: { value: BracketFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 1, label: getBracketTagLabel(1)! },
  { value: 2, label: getBracketTagLabel(2)! },
  { value: 3, label: getBracketTagLabel(3)! },
  { value: 4, label: getBracketTagLabel(4)! },
  { value: 5, label: getBracketTagLabel(5)! },
  { value: 'none', label: 'Unestimated' },
];

export function matchesBracketFilter(
  deck: Pick<Deck, 'bracketEstimate'> | undefined,
  filter: BracketFilter,
) {
  if (filter === 'all') return true;
  if (!deck) return false;
  if (filter === 'none') return deck.bracketEstimate == null;
  return deck.bracketEstimate === filter;
}

export function matchesDeckSearch(
  deck: Pick<Deck, 'name' | 'inPlay'> | undefined,
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (!deck) return false;

  if ((deck.name ?? '').toLowerCase().includes(normalized)) return true;

  const commanders = getCommanderNames(Object.values(deck.inPlay ?? {}));
  return commanders.some(name => name.toLowerCase().includes(normalized));
}

export function matchesDeckPanelFilters(
  deck: Pick<Deck, 'bracketEstimate' | 'name' | 'inPlay'> | undefined,
  bracketFilter: BracketFilter,
  searchQuery: string,
) {
  return matchesBracketFilter(deck, bracketFilter) && matchesDeckSearch(deck, searchQuery);
}

export const DeckBracketFilterBar: Component<{
  value: BracketFilter;
  onChange(filter: BracketFilter): void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchBarEnd?: JSX.Element;
  class?: string;
}> = props => (
  <div class={`flex flex-wrap items-center gap-3 ${props.class ?? ''}`}>
    <Show when={props.onSearchChange}>
      <div class='flex min-w-[11rem] flex-1 basis-52 max-w-lg items-center gap-2'>
        <TextField class='min-w-0 flex-1'>
          <TextFieldInput
            type='search'
            placeholder='Search decks or commanders…'
            value={props.searchQuery ?? ''}
            onInput={event => props.onSearchChange?.(event.currentTarget.value)}
            aria-label='Search decks'
          />
        </TextField>
        {props.searchBarEnd}
      </div>
    </Show>
    <div class='flex flex-wrap items-center gap-2'>
      <span class='text-sm text-muted-foreground'>Bracket</span>
    <For each={BRACKET_FILTER_OPTIONS}>
      {option => (
        <Button
          type='button'
          size='sm'
          variant={props.value === option.value ? 'default' : 'outline'}
          class='h-7 px-2.5 text-xs'
          style={
            props.value === option.value && option.value !== 'all' && option.value !== 'none'
              ? {
                  'background-color': getBracketColor(option.value),
                  'border-color': getBracketColor(option.value),
                }
              : undefined
          }
          onClick={() => props.onChange(option.value)}>
          {option.label}
        </Button>
      )}
    </For>
    </div>
  </div>
);
