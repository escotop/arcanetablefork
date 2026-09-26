import { render } from 'solid-js/web';
import { setupClientErrorReporting } from './lib/clientErrorReporting';
import { silenceConsoleInProduction } from './lib/devLog';
import { pruneStaleGameDatabases } from './lib/gamePersistence';
import App from './app';

setupClientErrorReporting();
silenceConsoleInProduction();
void pruneStaleGameDatabases();

render(() => <App />, document.getElementById('app')!);
