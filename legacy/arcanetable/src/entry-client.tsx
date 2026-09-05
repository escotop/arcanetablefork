import { render } from 'solid-js/web';
import * as Sentry from '@sentry/solidstart';
import { solidRouterBrowserTracingIntegration } from '@sentry/solidstart/solidrouter';
import { silenceConsoleInProduction } from './lib/devLog';
import { pruneStaleGameDatabases } from './lib/gamePersistence';
import App from './app';

silenceConsoleInProduction();

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    solidRouterBrowserTracingIntegration(),
  ],
  tracesSampleRate: 1.0,
});

void pruneStaleGameDatabases();

render(() => <App />, document.getElementById('app')!);
