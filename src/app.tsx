import { Route, Router } from '@solidjs/router';
import { ColorModeProvider, ColorModeScript, createLocalStorageManager } from '@kobalte/core';
import { Component, ErrorBoundary, lazy, Suspense } from 'solid-js';
import { MetaProvider } from '@solidjs/meta';
import { CardSystemProvider } from './lib/deckStore';
import { Toaster } from './components/ui/sonner';
import LandingPage from './routes/index';
import ClientOnly from './lib/clientOnly';
import './app.css';
import './index.css';

const App: Component = () => {
  const storageManager = createLocalStorageManager('vite-ui-theme');

  return (
    <Router
      root={props => (
        <ErrorBoundary fallback={() => <div>Something went wrong</div>}>
          <MetaProvider>
            <CardSystemProvider>
              <ColorModeScript storageType={storageManager.type} />
              <ColorModeProvider storageManager={storageManager}>
                <Suspense>{props.children}</Suspense>
                <Toaster />
              </ColorModeProvider>
            </CardSystemProvider>
          </MetaProvider>
        </ErrorBoundary>
      )}>
      <Route path='/' component={LandingPage} />
      <ClientOnly>
        <Route path='/game/:gameId' component={lazy(() => import('./pages/game/[id]'))} />
        <Route path='/table-view' component={lazy(() => import('./pages/game/table-view/index'))} />
      </ClientOnly>
    </Router>
  );
};

export default App;
