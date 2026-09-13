import { Component, For } from 'solid-js';
import { Button } from '~/components/ui/button';
import { Deck } from '~/lib/constants';
import { getBracketColor, getBracketTagLabel } from '~/lib/commanderBracket';

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

export const DeckBracketFilterBar: Component<{
  value: BracketFilter;
  onChange(filter: BracketFilter): void;
  class?: string;
}> = props => (
  <div class={`flex flex-wrap items-center gap-2 ${props.class ?? ''}`}>
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
);
