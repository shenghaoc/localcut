/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './ui/App';
import './global.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

render(() => <App />, root);
