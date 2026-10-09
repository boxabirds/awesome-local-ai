import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installTestHooks } from './testHooks';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('missing #root element');
}

installTestHooks();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
