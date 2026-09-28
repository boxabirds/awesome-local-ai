import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { newBoardId } from '../shared/board-id';
import './styles.css';

// Route: if at root, redirect to /b/<newBoardId()>
if (window.location.pathname === '/' || window.location.pathname === '') {
  window.location.replace(`/b/${newBoardId()}`);
} else {
  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root element');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
