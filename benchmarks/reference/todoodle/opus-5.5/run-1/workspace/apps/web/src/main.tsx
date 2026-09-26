import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { startBootOpen } from './features/workspace/bootOpen.ts';

// Start opening /w#<secret> before React renders, in parallel with the Workspace chunk (async-parallel).
startBootOpen(window.location);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
