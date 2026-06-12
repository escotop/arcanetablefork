import { Route, Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';
import { Component, ErrorBoundary, lazy, Suspense } from 'solid-js';
import IndexPage from './routes/index';
import { ColorModeProvider, ColorModeScript, createLocalStorageManager } from '@kobalte/core';
import { AnalyticsContext } from './lib/analytics';
import { CardSystemProviderClient } from './lib/cardSystemProviderClient';
import { Toaster } from './components/ui/sonner';
import { getBuildData } from './lib/console-capture';
import { MetaProvider } from '@solidjs/meta';
import './app.css';
import './index.css';
import ClientOnly from './lib/clientOnly';
import { withSentryRouterRouting } from '@sentry/solidstart/solidrouter';
import { withSentryErrorBoundary } from '@sentry/solidstart';

const SentryRouter = withSentryRouterRouting(Router);
const SentryErrorBoundry = withSentryErrorBoundary(ErrorBoundary);

const App: Component = () => {
  const storageManager = createLocalStorageManager('vite-ui-theme');
  return (
    <SentryRouter
      root={props => (
        <SentryErrorBoundry
          fallback={(error, reset) => {
            console.trace(error);
            return <div>Something went wrong</div>;
          }}>
          <MetaProvider>
            <CardSystemProviderClient>
              <AnalyticsContext>
                <script>
                  {`
                  window.env = ${JSON.stringify(getBuildData())}
                `}
                </script>
                <ColorModeScript storageType={storageManager.type} />
                <ColorModeProvider storageManager={storageManager}>
                  <Suspense>{props.children}</Suspense>
                  <Toaster />
                </ColorModeProvider>
              </AnalyticsContext>
            </CardSystemProviderClient>
          </MetaProvider>
        </SentryErrorBoundry>
      )}>
      <ClientOnly>
        <Route path='/game/:gameId' component={lazy(() => import('./pages/game/[id]'))} />
        <Route path='/table-view' component={lazy(() => import('./pages/game/table-view/index'))} />
      </ClientOnly>
      <FileRoutes />
    </SentryRouter>
  );
};

export default App;
