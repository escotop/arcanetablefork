import { Route, Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';
import { Component, lazy, Suspense } from 'solid-js';
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

const GameRoute = lazy(() => import('./routes/game/[id]'));

const App: Component = () => {
  const storageManager = createLocalStorageManager('vite-ui-theme');
  return (
    <Router
      root={props => (
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
      )}>
      <Route path='/' component={lazy(() => import('./routes/index'))} />
      <Route path='/changes' component={lazy(() => import('./routes/changes/index'))} />
      <ClientOnly>
        <Route path='/game/:gameId' component={GameRoute} />
      </ClientOnly>
      {/*<FileRoutes />*/}
    </Router>
  );
};

export default App;
