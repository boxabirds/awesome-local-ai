import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { testHooks } from './canvas/testHooks';
import './styles.css';

// Registers window.__vidi6 only in test mode (no-op in production builds).
testHooks();

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
