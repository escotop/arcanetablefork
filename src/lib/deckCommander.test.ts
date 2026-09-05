import { expect, test } from 'vitest';
import { canBeCommander, sortCommandersFirst } from './deckCommander';
import type { DetailedCardEntry } from './constants';

function entry(detail: DetailedCardEntry['detail']): Pick<DetailedCardEntry, 'detail'> {
  return { detail };
}

test('allows legendary creatures', () => {
  expect(
    canBeCommander(entry({ type_line: 'Legendary Creature — Human Wizard' } as never)),
  ).toBe(true);
  expect(
    canBeCommander(
      entry({ type_line: 'Legendary Artifact Creature — Robot Artificer' } as never),
    ),
  ).toBe(true);
});

test('allows legendary vehicles with power and toughness', () => {
  expect(
    canBeCommander(
      entry({
        type_line: 'Legendary Artifact — Vehicle',
        power: '6',
        toughness: '5',
      } as never),
    ),
  ).toBe(true);
});

test('allows legendary spacecraft with power and toughness', () => {
  expect(
    canBeCommander(
      entry({
        type_line: 'Legendary Artifact — Spacecraft',
        power: '4',
        toughness: '4',
      } as never),
    ),
  ).toBe(true);
});

test('rejects legendary vehicles without power and toughness', () => {
  expect(
    canBeCommander(entry({ type_line: 'Legendary Artifact — Vehicle' } as never)),
  ).toBe(false);
});

test('rejects non-commander cards', () => {
  expect(canBeCommander(entry({ type_line: 'Artifact Creature — Construct' } as never))).toBe(
    false,
  );
  expect(canBeCommander(entry({ type_line: 'Legendary Artifact — Equipment' } as never))).toBe(
    false,
  );
});

test('allows oracle text that explicitly permits commander', () => {
  expect(
    canBeCommander(
      entry({
        type_line: 'Legendary Planeswalker — Tevesh',
        effect: 'Tevesh Szade, Doom of Fools can be your commander.',
      } as never),
    ),
  ).toBe(true);
});

test('sorts commanders before other cards', () => {
  const sorted = sortCommandersFirst([
    { name: 'Sol Ring', categories: [] },
    { name: 'Kilo', categories: ['commander'] },
    { name: 'Island', categories: [] },
    { name: 'Thrasios', categories: ['commander'] },
  ] as never);

  expect(sorted.map(card => card.name)).toEqual(['Kilo', 'Thrasios', 'Sol Ring', 'Island']);
});

test('checks each card face on double-faced cards', () => {
  expect(
    canBeCommander(
      entry({
        type_line: 'Legendary Creature — Human Rogue // Legendary Artifact — Equipment',
        card_faces: [
          { type_line: 'Legendary Creature — Human Rogue' },
          { type_line: 'Legendary Artifact — Equipment' },
        ],
      } as never),
    ),
  ).toBe(true);

  expect(
    canBeCommander(
      entry({
        type_line: 'Sorcery // Legendary Enchantment — Background',
        card_faces: [
          { type_line: 'Sorcery' },
          {
            type_line: 'Legendary Enchantment — Background',
            effect: 'This card can be your commander if you have a Background commander.',
          },
        ],
      } as never),
    ),
  ).toBe(true);

  expect(
    canBeCommander(
      entry({
        card_faces: [{ type_line: 'Instant' }, { type_line: 'Sorcery' }],
      } as never),
    ),
  ).toBe(false);
});
