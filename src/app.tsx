import { Route, Router } from '@solidjs/router';
import { ColorModeProvider, ColorModeScript, createLocalStorageManager } from '@kobalte/core';
import { Component, ErrorBoundary, lazy, Suspense } from 'solid-js';
import { MetaProvider } from '@solidjs/meta';
import { CardSystemProvider } from './lib/deckStore';
import { Toaster } from './components/ui/sonner';
import LandingPage from './routes/index';
import ClientOnly from './lib/clientOnly';
import { reportClientError } from './lib/clientErrorReporting';
import StackTraceDialog from './lib/stack-trace-dialog';
import { Button } from './components/ui/button';
import './app.css';
import './index.css';

const App: Component = () => {
  const storageManager = createLocalStorageManager('vite-ui-theme');

  return (
    <Router
      root={props => (
        <>
          <ErrorBoundary
            fallback={(err, reset) => {
              reportClientError(err);
              return (
                <div class='flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center'>
                  <p class='text-lg font-medium'>Something went wrong</p>
                  <p class='max-w-md text-sm text-muted-foreground'>
                    An error report dialog should open with details you can copy. If it did not,
                    check the browser console.
                  </p>
                  <Button type='button' onClick={reset}>
                    Try again
                  </Button>
                </div>
              );
            }}>
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
          <StackTraceDialog />
        </>
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
