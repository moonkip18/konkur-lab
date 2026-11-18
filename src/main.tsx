import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './theme.css';
import './answerkey.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The boot notice in index.html only exists to explain a failed boot (usually
// the file being opened directly from disk). React owns #root now, so remove it.
document.getElementById('boot-notice')?.remove();

// Offline support. autoUpdate means a new build takes over on the next load
// rather than stranding the user on a cached shell.
registerSW({ immediate: true });