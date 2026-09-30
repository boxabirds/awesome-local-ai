import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.MODE === 'test') window.__vidi6Unmount = () => root.unmount();
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
