// The home page (design "Home page", PRD "Create a board"): the product name,
// one line, one button. Everything the create request can do wrong is answered
// with a sentence under the button (share.create_failure, share.rate_limit) —
// the visitor is never left looking at a button that stopped responding.

import { useCreateBoard } from './useCreateBoard.ts';

const TAGLINE = 'A shared board for thinking together';

export default function HomePage() {
  const { busy, error, create } = useCreateBoard();

  return (
    <main className="home-page" data-testid="home-page">
      <h1 className="home-title">vidi6</h1>
      <p className="home-tagline">{TAGLINE}</p>
      <button
        type="button"
        className="home-create"
        data-testid="create-board"
        onClick={() => void create()}
        disabled={busy}
      >
        {busy ? 'Creating…' : 'Create a new board'}
      </button>
      {/* The copy differs per failure (share.create_failure vs share.rate_limit),
          so this region is always its own element. */}
      {error !== null && (
        <p className="home-error" role="alert" data-testid="home-error">
          {error}
        </p>
      )}
    </main>
  );
}
