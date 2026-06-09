import { mount, StartClient } from '@solidjs/start/client';
import * as Sentry from '@sentry/solidstart';
import { solidRouterBrowserTracingIntegration } from '@sentry/solidstart/solidrouter';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // To disable sending user data, uncomment the line below. For more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/solidstart/configuration/options/#dataCollection
  // dataCollection: { userInfo: false },
  integrations: [solidRouterBrowserTracingIntegration(), Sentry.replayIntegration()],
  // Tracing
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  // Session Replay
  replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
  replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
});

mount(() => <StartClient />, document.getElementById('app')!);
