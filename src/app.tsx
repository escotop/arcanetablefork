import { Route, Router } from '@solidjs/router';
import { Component, lazy, Suspense } from 'solid-js';
import IndexPage from './routes/page';
import { ColorModeProvider, ColorModeScript, createLocalStorageManager } from '@kobalte/core';
import { AnalyticsContext } from './lib/analytics';
import { CardSystemProvider } from './lib/deckStore';
import { Toaster } from './components/ui/sonner';
import { getBuildData } from './lib/console-capture';
import { MetaProvider } from '@solidjs/meta';
import './app.css';
import './index.css';

const GameRoute = lazy(() => import('./routes/game/[id]'))

const App: Component = () => {
  const storageManager = createLocalStorageManager('vite-ui-theme');
  return (
    <Router
      root={props => (
        <MetaProvider>
          <CardSystemProvider>
            <AnalyticsContext>
              <script>
                {`
                window.env = ${getBuildData()}
              `}
              </script>
              <ColorModeScript storageType={storageManager.type} />
              <ColorModeProvider storageManager={storageManager}>
                {/* <Nav /> */}
                <Suspense>{props.children}</Suspense>
                <Toaster />
              </ColorModeProvider>
            </AnalyticsContext>
          </CardSystemProvider>
        </MetaProvider>
      )}>
      <Route path='/' component={IndexPage} />
      <Route path='/game/:gameId' component={GameRoute} />
    </Router>
  );
};

export default App;
