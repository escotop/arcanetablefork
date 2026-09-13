const isDev = import.meta.env.DEV;

const noop = (..._args: unknown[]) => {};

function bindConsole(method: 'log' | 'warn' | 'error' | 'info' | 'debug') {
  if (method === 'error') {
    return (...args: unknown[]) => console.error(...args);
  }
  return isDev ? (...args: unknown[]) => console[method](...args) : noop;
}

export const devLog = {
  log: bindConsole('log'),
  warn: bindConsole('warn'),
  error: bindConsole('error'),
  info: bindConsole('info'),
  debug: bindConsole('debug'),
};

/** Mute noisy console methods in production; errors still log to the console. */
export function silenceConsoleInProduction() {
  if (!import.meta.env.PROD) return;

  console.log = noop;
  console.warn = noop;
  console.info = noop;
  console.debug = noop;
}
