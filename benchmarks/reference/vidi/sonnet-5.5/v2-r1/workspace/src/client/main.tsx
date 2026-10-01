import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import './styles.css';

// `/` redirects to a fresh board address (replaced by server-side creation in story 5).
function currentBoardId(): string {
  const match = /^\/b\/([^/]+)\/?$/.exec(location.pathname);
  if (match && isValidBoardId(match[1])) return match[1];
  const id = newBoardId();
  history.replaceState(null, '', `/b/${id}`);
  return id;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App boardId={currentBoardId()} />
  </StrictMode>,
);
