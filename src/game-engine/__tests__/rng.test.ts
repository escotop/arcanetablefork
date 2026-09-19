/**
 * Tests for deterministic RNG
 */

import { describe, test, expect } from 'vitest';
import { seededShuffle, seededRandomElement, seededRandomRange } from '../rng';

describe('RNG', () => {
  describe('seededShuffle', () => {
    test('produces same result for same seed and counter', () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      const shuffle1 = seededShuffle(array, 'test-seed', 0);
      const shuffle2 = seededShuffle(array, 'test-seed', 0);
      
      expect(shuffle1).toEqual(shuffle2);
    });

    test('produces different result for different counter', () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      const shuffle1 = seededShuffle(array, 'test-seed', 0);
      const shuffle2 = seededShuffle(array, 'test-seed', 1);
      
      expect(shuffle1).not.toEqual(shuffle2);
    });

    test('produces different result for different seed', () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      const shuffle1 = seededShuffle(array, 'seed-a', 0);
      const shuffle2 = seededShuffle(array, 'seed-b', 0);
      
      expect(shuffle1).not.toEqual(shuffle2);
    });

    test('contains all original elements', () => {
      const array = [1, 2, 3, 4, 5];
      
      const shuffled = seededShuffle(array, 'test-seed', 0);
      
      expect(shuffled.sort()).toEqual(array.sort());
    });

    test('does not mutate original array', () => {
      const array = [1, 2, 3, 4, 5];
      const original = [...array];
      
      seededShuffle(array, 'test-seed', 0);
      
      expect(array).toEqual(original);
    });

    test('handles empty array', () => {
      const result = seededShuffle([], 'test-seed', 0);
      expect(result).toEqual([]);
    });

    test('handles single element', () => {
      const result = seededShuffle([1], 'test-seed', 0);
      expect(result).toEqual([1]);
    });

    test('shuffle is actually random (not identity)', () => {
      // With 10 elements, chance of getting same order is 1/10! = 1/3,628,800
      // So it's safe to assert they're different
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      const shuffled = seededShuffle(array, 'test-seed', 0);
      
      // Should be different from original order (with extremely high probability)
      expect(shuffled).not.toEqual(array);
    });
  });

  describe('seededRandomElement', () => {
    test('returns same element for same seed', () => {
      const array = ['a', 'b', 'c', 'd', 'e'];
      
      const elem1 = seededRandomElement(array, 'test-seed', 0);
      const elem2 = seededRandomElement(array, 'test-seed', 0);
      
      expect(elem1).toBe(elem2);
    });

    test('returns element from array', () => {
      const array = ['a', 'b', 'c'];
      
      const elem = seededRandomElement(array, 'test-seed', 0);
      
      expect(array).toContain(elem);
    });

    test('returns undefined for empty array', () => {
      const elem = seededRandomElement([], 'test-seed', 0);
      expect(elem).toBeUndefined();
    });
  });

  describe('seededRandomRange', () => {
    test('returns same value for same seed', () => {
      const val1 = seededRandomRange(1, 10, 'test-seed', 0);
      const val2 = seededRandomRange(1, 10, 'test-seed', 0);
      
      expect(val1).toBe(val2);
    });

    test('returns value in range', () => {
      for (let i = 0; i < 100; i++) {
        const val = seededRandomRange(5, 15, 'test-seed', i);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThan(15);
      }
    });
  });

  describe('determinism across shuffle operations', () => {
    test('sequence of shuffles is reproducible', () => {
      const deck = Array.from({ length: 52 }, (_, i) => i);
      
      // First sequence
      const shuffle1a = seededShuffle(deck, 'game-seed', 0);
      const shuffle1b = seededShuffle(shuffle1a, 'game-seed', 1);
      const shuffle1c = seededShuffle(shuffle1b, 'game-seed', 2);
      
      // Second sequence
      const shuffle2a = seededShuffle(deck, 'game-seed', 0);
      const shuffle2b = seededShuffle(shuffle2a, 'game-seed', 1);
      const shuffle2c = seededShuffle(shuffle2b, 'game-seed', 2);
      
      expect(shuffle1a).toEqual(shuffle2a);
      expect(shuffle1b).toEqual(shuffle2b);
      expect(shuffle1c).toEqual(shuffle2c);
    });
  });
});
