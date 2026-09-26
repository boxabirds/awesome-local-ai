import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import './styles.css';

const container = document.getElementById('root');

/**
 * Resolve the board to render from the URL:
 *
 *   /b/<boardId>  → that board (when the id is well-formed)
 *   anything else → a fresh random board, with the URL rewritten to /b/<id>
 *
 * The rewrite (replaceState, no reload) keeps deep links shareable and gives
 * every fresh visit its own board until story 5 adds server-side creation.
 */
function resolveBoardId(): string {
  const pathname = window.location.pathname;
  if (pathname.startsWith('/b/')) {
    const raw = decodeURIComponent(pathname.slice('/b/'.length));
    if (isValidBoardId(raw)) return raw;
  }
  const fresh = newBoardId();
  window.history.replaceState(null, '', `/b/${fresh}`);
  return fresh;
}

if (container) {
  const boardId = resolveBoardId();
  createRoot(container).render(
    <StrictMode>
      <App boardId={boardId} />
    </StrictMode>,
  );
}
