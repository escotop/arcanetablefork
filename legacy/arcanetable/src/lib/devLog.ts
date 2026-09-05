const isDev = import.meta.env.DEV;

const noop = (..._args: unknown[]) => {};

function bindConsole(method: 'log' | 'warn' | 'error' | 'info' | 'debug') {
  return isDev ? (...args: unknown[]) => console[method](...args) : noop;
}

export const devLog = {
  log: bindConsole('log'),
  warn: bindConsole('warn'),
  error: bindConsole('error'),
  info: bindConsole('info'),
  debug: bindConsole('debug'),
};

/** No-op console methods in production (including third-party logs). */
export function silenceConsoleInProduction() {
  if (!import.meta.env.PROD) return;

  console.log = noop;
  console.warn = noop;
  console.error = noop;
  console.info = noop;
  console.debug = noop;
}
