import { createEffect, createMemo, For, Show } from 'solid-js';
import { DetailedCardEntry } from '~/lib/constants';
import AddIcon from 'lucide-solid/icons/plus';
import SubIcon from 'lucide-solid/icons/minus';
import { capitalize } from 'lodash-es';
import { Button } from '~/components/ui/button';
import { cardSystem } from '~/lib/globals';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '~/components/ui/hover-card';
import { getCardImage } from '~/lib/card';
import useCardGrouping from './cardGroupings';
import { ImportsNotUsedAsValues } from 'typescript';

interface Props {
  entries: DetailedCardEntry[];
  addCard(entry: DetailedCardEntry): void;
  removeCard(entry: DetailedCardEntry): void;
}

export default function CardList(props: Props) {
  const lowerTypes = createMemo(() => (cardSystem.types ?? []).map(type => type.toLowerCase()));
  const grouped = useCardGrouping(cardSystem.types ?? [], () => props.entries);

  return (
    <>
      <div class='flex flex-col gap-1 overflow-y-auto slim-scroll'>
        <For each={lowerTypes()}>
          {cardType => {
            let group = () => grouped().types[cardType];
            return (
              <Show when={group().count > 0}>
                <h2 class='text-muted-foreground flex gap-1 justify-between mt-4 px-4'>
                  <span>{capitalize(cardType)}</span>
                  <span class='pr-4'>{group().count}</span>
                </h2>
                <hr class='mx-4' />

                <For each={group().items}>
                  {entry => (
                    <CardEntry
                      entry={entry}
                      addCard={() => props.addCard(entry)}
                      removeCard={() => props.removeCard(entry)}
                    />
                  )}
                </For>
              </Show>
            );
          }}
        </For>
        <Show when={grouped().unsorted.count > 0}>
          <h2 class='text-muted-foreground flex gap-1 justify-between mt-4 px-4'>
            <span class='pr-4'>Unsorted</span>
            <span>{grouped().unsorted.count}</span>
          </h2>
          <hr />

          <For each={grouped().unsorted.items}>
            {entry => (
              <CardEntry
                entry={entry}
                addCard={() => props.addCard(entry)}
                removeCard={() => props.removeCard(entry)}
              />
            )}
          </For>
        </Show>
      </div>
      <hr class='mx-4 mt-auto' />
    </>
  );
}

function CardEntry(props: { entry: DetailedCardEntry; addCard(): void; removeCard(): void }) {
  return (
    <HoverCard placement='right'>
      <HoverCardTrigger>
        <div class='flex gap-2 items-center px-4 hover:bg-accent' id={props.entry.id}>
          <span class='text-primary font-bold text-xl items-center'>{props.entry.qty}</span>
          <span class='truncate grow align-center'>{props.entry.name}</span>
          <Button size='sm' variant='ghost' type='button' onClick={props.removeCard}>
            <SubIcon class='text-muted-foreground' />
          </Button>
          <Button size='sm' variant='ghost' type='button' onClick={props.addCard}>
            <AddIcon class='text-muted-foreground' />
          </Button>
        </div>
      </HoverCardTrigger>
      <HoverCardContent class='w-128 fade-in'>
        <img src={getCardImage(props.entry)} />
      </HoverCardContent>
    </HoverCard>
  );
}
