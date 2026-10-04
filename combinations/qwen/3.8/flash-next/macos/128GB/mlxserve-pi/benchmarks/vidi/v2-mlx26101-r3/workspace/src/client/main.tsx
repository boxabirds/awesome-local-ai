import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { JSX } from 'react';
import { App } from './App';
import { BOARD_ID_PATTERN, newBoardId } from '../shared/board-id';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root element is missing from index.html');
}

/**
 * What the address bar asks for. The board's id is part of the address, so a board is opened
 * by naming it - nothing is looked up, created or remembered here.
 */
type Route =
  | { readonly kind: 'board'; readonly boardId: string }
  | { readonly kind: 'new-board' }
  | { readonly kind: 'no-board' };

function routeOf(pathname: string): Route {
  if (pathname === '/' || pathname === '' || pathname === '/index.html') {
    // No board named: this tab gets a board of its own. Story 5 replaces this with a board
    // that is created by the server and listed afterwards.
    return { kind: 'new-board' };
  }
  const segment = /^\/b\/([^/]+)\/?$/.exec(pathname)?.[1];
  const boardId = segment === undefined ? null : decodeURIComponent(segment);
  return boardId !== null && BOARD_ID_PATTERN.test(boardId)
    ? { kind: 'board', boardId }
    : { kind: 'no-board' };
}

/**
 * Shown for an address that names no board. A board id is 22 characters the generator made;
 * typing something else into the address bar is not a board that does not exist yet, it is
 * not a board id at all, and connecting to it would fail at the Worker for the same reason.
 */
function NoBoard(): JSX.Element {
  return (
    <main className="no-board" data-testid="no-board">
      <h1>This address is not a board</h1>
      <p>
        A board address looks like <code>/b/</code> followed by 22 characters, the way a shared
        link gives it to you.
      </p>
      <p>
        <a href="/">Open a new board</a>
      </p>
    </main>
  );
}

const root: Root = createRoot(container);

/**
 * Render what the address names. A board is mounted under its own id as the React key, so
 * moving from one board to another builds a new document and a new connection instead of
 * carrying one board's notes into another board's room.
 */
function renderAddress(): void {
  const route = routeOf(window.location.pathname);
  if (route.kind === 'no-board') {
    root.render(
      <StrictMode>
        <NoBoard />
      </StrictMode>,
    );
    return;
  }
  const boardId = route.kind === 'board' ? route.boardId : newBoardId();
  if (route.kind === 'new-board') {
    window.history.replaceState(null, '', `/b/${boardId}`);
  }
  root.render(
    <StrictMode>
      <App key={boardId} boardId={boardId} />
    </StrictMode>,
  );
}

renderAddress();
// Back and forward between boards are navigations, and a navigation means a different room.
window.addEventListener('popstate', renderAddress);
