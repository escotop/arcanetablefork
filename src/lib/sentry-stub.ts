export function captureException(error: unknown, _context?: unknown) {
  console.error(error);
}

export function withSentryErrorBoundary<T>(component: T): T {
  return component;
}

export const init = () => {};
