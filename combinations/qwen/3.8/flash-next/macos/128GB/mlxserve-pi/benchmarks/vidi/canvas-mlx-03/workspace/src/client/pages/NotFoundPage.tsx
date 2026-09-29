// The Board Not Found page (design "Board Not Found page", PRD share.not_found).
// One component for both cases the Worker answers 404 for: a link whose board
// does not exist, and a link that is not a valid board id at all.
//
// It renders no canvas, no board component and no Yjs document — the absence of
// `data-testid="canvas-layer"` is the assertion that nothing of the board was
// mounted here, and nothing is created at this address either.
//
// The way out is a board of their own, not a dead end: the button is the home
// page's own create action (PRD share.not_found), so a mistyped link is one click
// from working. The link home is kept beside it for a visitor who would rather
// look around first.

import { useCreateBoard } from './useCreateBoard.ts';

const HEADING = 'Board not found';
const BODY = "Check the link, or ask the person who shared it to send it again.";

export default function NotFoundPage({ boardId }: { boardId: string }) {
  const { busy, error, create } = useCreateBoard();

  return (
    <main className="not-found-page" data-testid="board-not-found" data-board-id={boardId}>
      <h1 className="not-found-title">{HEADING}</h1>
      {/* The id the visitor already has in the address bar is deliberately not
          repeated back at them: it is what they got wrong. */}
      <p className="not-found-body" role="status">
        {BODY}
      </p>
      <div className="not-found-actions">
        <button
          type="button"
          className="home-create"
          data-testid="create-new-board"
          onClick={() => void create()}
          disabled={busy}
        >
          {busy ? 'Creating…' : 'Create a new board'}
        </button>
        <a className="not-found-home" href="/" data-testid="back-home">
          Back to the home page
        </a>
      </div>
      {/* The same two sentences the home page uses: a create that fails here fails
          for the same reasons, and says so the same way. */}
      {error !== null && (
        <p className="not-found-error" role="alert" data-testid="create-new-board-error">
          {error}
        </p>
      )}
    </main>
  );
}
