import { Accessor, createEffect, on, onCleanup } from 'solid-js';

interface Opts {
  /** Scroll container to measure against (needed for rootMargin inside a scrollable box). */
  root?: Element | null;
  rootMargin?: string;
  threshold?: number | number[];
  /**
   * When this value changes, the element is checked again. Use it to keep loading
   * while the element is still in view after new content was added.
   */
  recheck?: unknown;
  onIntersect(entry: IntersectionObserverEntry): void;
}

export default function intersectionObserver(element: HTMLElement, opts: Accessor<Opts>) {
  const { root, rootMargin, threshold, onIntersect } = opts();

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          onIntersect(entry);
        }
      });
    },
    {
      root: root ?? null,
      threshold,
      rootMargin,
    },
  );

  observer.observe(element);

  createEffect(
    on(
      () => opts().recheck,
      () => {
        // Re-observing triggers a fresh callback with the current intersection state.
        observer.unobserve(element);
        observer.observe(element);
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    observer.disconnect();
  });
}
