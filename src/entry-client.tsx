import { render } from 'solid-js/web';
import { silenceConsoleInProduction } from './lib/devLog';
import { pruneStaleGameDatabases } from './lib/gamePersistence';
import App from './app';

silenceConsoleInProduction();
void pruneStaleGameDatabases();

render(() => <App />, document.getElementById('app')!);
