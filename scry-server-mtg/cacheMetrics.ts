let hits = 0,
  misses = 0,
  upstreamFetches = 0;

export const cacheMetrics = {
  hit: () => void hits++,
  miss: () => void misses++,
  fetchedUpstream: () => void upstreamFetches++,
  snapshot() {
    const total = hits + misses;
    return { hits, misses, total, hitRate: total ? hits / total : 0, upstreamFetches };
  },
};
