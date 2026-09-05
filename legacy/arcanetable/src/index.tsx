import { render } from 'solid-js/web';

import App from './app';
import './app.css';
import './index.css';

const root = document.getElementById('root');

render(() => <App />, root!);
