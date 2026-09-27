import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { startBootOpen } from './features/workspace/bootOpen';

// Start opening /w#<secret> now, in parallel with the Workspace route chunk download.
startBootOpen(window.location);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
