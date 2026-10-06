import { expect, test } from 'vitest';
import { getMoxfieldDeckBracket } from './bracket';

test('getMoxfieldDeckBracket prefers bracket then user then auto', () => {
  expect(getMoxfieldDeckBracket({ bracket: 3, userBracket: 4, autoBracket: 2 })).toBe(3);
  expect(getMoxfieldDeckBracket({ userBracket: 4, autoBracket: 2 })).toBe(4);
  expect(getMoxfieldDeckBracket({ autoBracket: 2 })).toBe(2);
});

test('getMoxfieldDeckBracket respects ignoreBrackets', () => {
  expect(getMoxfieldDeckBracket({ ignoreBrackets: true, bracket: 3 })).toBeUndefined();
});

test('getMoxfieldDeckBracket rejects out-of-range values', () => {
  expect(getMoxfieldDeckBracket({ bracket: 0 })).toBeUndefined();
  expect(getMoxfieldDeckBracket({ bracket: 6 })).toBeUndefined();
});
