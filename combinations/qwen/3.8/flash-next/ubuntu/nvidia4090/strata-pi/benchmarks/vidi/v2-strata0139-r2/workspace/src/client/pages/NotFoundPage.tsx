/**
 * Board not found (`share.not_found`).
 *
 * Shown for a link that names no board: a valid-looking id the server says
 * nothing about, an id that is not a board id at all, or any other path. The
 * page says what it knows — this address is not a board — and what it can do:
 * make a new board, or go home.
 *
 * The wording is deliberately not "this board was deleted". vidi6 has no
 * deletion yet (story 15); the likeliest causes are a mistyped or partially
 * copied link, or a link that was never a board.
 */

import { HOME_PATH } from "../routing";
import type { CreateBoardFn } from "../api";
import { useCreateBoard } from "./HomePage";

export interface NotFoundPageProps {
  /** The address that was not found, shown so a person can see what went wrong. */
  pathname: string;
  navigate?: (pathname: string, options?: { replace?: boolean }) => void;
  /** Injectable for component tests. */
  create?: CreateBoardFn;
}

export function NotFoundPage({ pathname, navigate, create }: NotFoundPageProps) {
  // The same "New board" the home page uses — including navigating to the board
  // it creates. `navigate` is optional only because this page can be rendered
  // standalone in a component test; without it the button is inert.
  const { creating, failed, start } = useCreateBoard({
    navigate: navigate ?? (() => undefined),
    ...(create === undefined ? {} : { create }),
  });

  return (
    <main className="page page-not-found" data-testid="not-found-page">
      <header className="page-header">
        <h1 className="page-title">Board not found</h1>
        <p className="page-subtitle">
          No board exists at{" "}
          <code data-testid="board-address" className="board-address">
            {pathname}
          </code>
          . The link may be mistyped, copied only part of the way, or a link that
          was never created.
        </p>
      </header>

      <div className="page-body">
        <button
          type="button"
          className="button button-primary"
          data-testid="new-board-button"
          onClick={() => void start()}
          disabled={creating || navigate === undefined}
        >
          {creating ? "Creating…" : "New board"}
        </button>

        <a className="button button-link" data-testid="home-link" href={HOME_PATH}>
          Go to vidi6
        </a>

        {failed && (
          <p className="form-error" role="alert" data-testid="create-error">
            Couldn&rsquo;t create a board. Please try again.
          </p>
        )}
      </div>
    </main>
  );
}
