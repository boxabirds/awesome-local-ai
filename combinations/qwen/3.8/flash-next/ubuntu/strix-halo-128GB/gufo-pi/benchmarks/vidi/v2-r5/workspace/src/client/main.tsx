import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { newBoardId } from '../shared/board-id';
import './styles.css';

// If the root path is accessed, redirect to a new board.
if (window.location.pathname === '/' || window.location.pathname === '') {
  window.location.replace(`/b/${newBoardId()}`);
} else {
  const container = document.getElementById('root');
  if (!container) throw new Error('root element missing');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
