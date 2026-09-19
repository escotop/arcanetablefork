/**
 * Deterministic RNG for game state
 * 
 * Uses seeded random to ensure all clients get the same shuffle results
 */

/**
 * Simple seeded random number generator (Mulberry32)
 * https://github.com/bryc/code/blob/master/jshash/PRNGs.md
 */
function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert string seed to number
 */
function seedToNumber(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Create a seeded RNG that combines base seed with a counter
 */
function createSeededRNG(baseSeed: string, counter: number): () => number {
  const combinedSeed = seedToNumber(baseSeed + ':' + counter);
  return mulberry32(combinedSeed);
}

/**
 * Shuffle an array using a seeded RNG
 * Fisher-Yates shuffle with deterministic random source
 */
export function seededShuffle<T>(
  array: readonly T[],
  seed: string,
  counter: number,
): T[] {
  const rng = createSeededRNG(seed, counter);
  const result = [...array];
  
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  
  return result;
}

/**
 * Get a random element from an array
 */
export function seededRandomElement<T>(
  array: readonly T[],
  seed: string,
  counter: number,
): T | undefined {
  if (array.length === 0) return undefined;
  
  const rng = createSeededRNG(seed, counter);
  const index = Math.floor(rng() * array.length);
  return array[index];
}

/**
 * Get a random number in range [min, max)
 */
export function seededRandomRange(
  min: number,
  max: number,
  seed: string,
  counter: number,
): number {
  const rng = createSeededRNG(seed, counter);
  return min + Math.floor(rng() * (max - min));
}
