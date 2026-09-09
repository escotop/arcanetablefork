import { Component, For, Show, createMemo } from 'solid-js';
import CheckIcon from 'lucide-solid/icons/check';
import type { CommanderBracketHowItPlaysSection } from '~/lib/commanderBracket';
import type { Card } from '~/lib/constants';
import { howItPlaysHandTick } from '~/lib/globals';

interface Props {
  section: CommanderBracketHowItPlaysSection;
  class?: string;
  handCards?: () => Card[];
}

function isCardLand(card: Card) {
  return card.detail?.type_line?.toLowerCase().includes('land') ?? false;
}

function countLandsInHand(cards: Card[]) {
  return cards.filter(isCardLand).length;
}

function handContainsCardName(cards: Card[], name: string) {
  const normalized = name.trim().toLowerCase();
  return cards.some(card => card.detail?.name?.trim().toLowerCase() === normalized);
}

function landCountClass(count: number, min: number, max: number) {
  return count >= min && count <= max ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold';
}

const HowItPlaysContent: Component<Props> = props => {
  const handSnapshot = createMemo(() => {
    howItPlaysHandTick();
    return props.handCards?.() ?? [];
  });
  const landCount = createMemo(() => countLandsInHand(handSnapshot()));

  return (
    <div class={props.class}>
      <Show when={props.section.summary}>
        <p class='text-sm text-muted-foreground'>{props.section.summary}</p>
      </Show>

      <Show
        when={
          props.section.bullets.length > 0 ||
          props.section.openerDetail ||
          props.section.worthHolding.length > 0
        }>
        <details class='group mt-3' open>
          <summary class='cursor-pointer text-sm font-medium marker:content-none [&::-webkit-details-marker]:hidden'>
            <span class='inline-flex items-center gap-1'>
              <span class='text-muted-foreground transition-transform group-open:rotate-90'>▸</span>
              Opening hand &amp; play advice
            </span>
          </summary>
          <div class='mt-2 space-y-3 pl-4'>
            <Show when={props.section.bullets.length > 0}>
              <ul class='list-disc space-y-1 pl-5 text-sm text-muted-foreground'>
                <For each={props.section.bullets}>
                  {bullet => (
                    <Show
                      when={
                        !(
                          props.section.landRange &&
                          props.handCards &&
                          bullet.startsWith('Keep ')
                        )
                      }
                      fallback={
                        <li>
                          Keep {props.section.landRange!.min}-{props.section.landRange!.max} lands
                          <span class={landCountClass(landCount(), props.section.landRange!.min, props.section.landRange!.max)}>
                            {' '}
                            ({landCount()} in hand)
                          </span>
                        </li>
                      }>
                      <li>{bullet}</li>
                    </Show>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={props.section.openerDetail}>
              <p class='text-sm text-muted-foreground'>{props.section.openerDetail}</p>
            </Show>

            <Show when={props.section.worthHolding.length > 0}>
              <div>
                <h4 class='mb-2 text-sm font-semibold'>Worth holding</h4>
                <div class='space-y-3'>
                  <For each={props.section.worthHolding}>
                    {card => {
                      const inHand = () => props.handCards && handContainsCardName(handSnapshot(), card.name);

                      return (
                        <div>
                          <div
                            classList={{
                              'inline-flex items-center gap-1.5 text-sm font-medium': true,
                              'text-green-600': !!inHand(),
                            }}>
                            <Show when={inHand()}>
                              <CheckIcon class='size-4 shrink-0' aria-hidden='true' />
                            </Show>
                            <span>{card.name}</span>
                          </div>
                          <Show when={card.reasonLabel}>
                            <div class='text-sm text-muted-foreground'>{card.reasonLabel}</div>
                          </Show>
                          <Show when={card.timingLabel}>
                            <div class='text-sm text-muted-foreground'>{card.timingLabel}</div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </details>
      </Show>
    </div>
  );
};

export default HowItPlaysContent;
