import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('root element not found');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
