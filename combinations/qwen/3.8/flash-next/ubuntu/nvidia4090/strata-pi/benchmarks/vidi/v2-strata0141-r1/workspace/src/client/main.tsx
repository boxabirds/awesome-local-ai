import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { resolveBoardId } from './board/boardRoute';
import { installTestHooks } from './testHooks';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('missing #root element');
}

installTestHooks();

// The address names the board; a page without one gets a brand new board and
// the address bar is changed to it.
const boardId = resolveBoardId(window.history, window.location.pathname);

createRoot(rootElement).render(
  <StrictMode>
    <App boardId={boardId} />
  </StrictMode>,
);
