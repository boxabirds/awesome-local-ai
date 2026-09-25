import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, resolveBoardRoute } from './App';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App boardId={resolveBoardRoute()} />
  </StrictMode>,
);
