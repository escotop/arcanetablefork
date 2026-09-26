import { captureConsole } from './console-capture';

const errorListeners = new Set<(error: Error) => void>();

let reportingInstalled = false;

export function subscribeClientErrors(listener: (error: Error) => void) {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

export function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  try {
    return new Error(JSON.stringify(reason));
  } catch {
    return new Error(String(reason));
  }
}

export function reportClientError(reason: unknown) {
  const error = toError(reason);
  for (const listener of errorListeners) listener(error);
  console.error(error);
}

export function setupClientErrorReporting() {
  if (reportingInstalled) return;
  reportingInstalled = true;

  (['log', 'warn', 'error'] as const).forEach(captureConsole);

  window.addEventListener('error', event => {
    reportClientError(event.error ?? event.message);
  });

  window.addEventListener('unhandledrejection', event => {
    reportClientError(event.reason);
  });
}
