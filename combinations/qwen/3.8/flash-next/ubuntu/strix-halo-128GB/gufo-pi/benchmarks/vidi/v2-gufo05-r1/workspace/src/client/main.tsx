import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, boardIdFromPath, newBoardPath } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

/**
 * Which board this address asks for.
 *
 * `/b/<boardId>` is the board. `/` opens a fresh one and puts its address in the
 * bar, because story 3 is about people sharing a board and until story 5 builds the
 * Share button, this redirect is the only way to get an address to share. Any other
 * address — including `/b/` with something in it that cannot be a board id — opens a
 * local board that talks to nobody: there is no room to talk to, and saying so on
 * screen is story 5's page.
 */
function boardIdToOpen(): string | undefined {
  const fromPath = boardIdFromPath(window.location.pathname);
  if (fromPath !== null) return fromPath;
  if (window.location.pathname !== '/') return undefined;
  const path = newBoardPath();
  window.history.replaceState(null, '', path);
  return path.slice('/b/'.length);
}

createRoot(container).render(
  <StrictMode>
    <App boardId={boardIdToOpen()} />
  </StrictMode>,
);
