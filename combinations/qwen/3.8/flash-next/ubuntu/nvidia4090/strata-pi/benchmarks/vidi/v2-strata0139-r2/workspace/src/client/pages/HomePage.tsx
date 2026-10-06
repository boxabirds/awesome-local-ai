/**
 * Home page (`share.create`, `share.create_failure`).
 *
 * One button, and the button does one thing: it asks the server for a board and
 * takes the person to it. Nothing here decides a board's id — creation is the
 * Worker's job, and the home page only asks.
 *
 * Two things are deliberately *not* on this page: a list of boards (story 5 is
 * about links, not about remembering boards) and a way to open a board by
 * typing an id (a link is how a board is shared; the address bar does the rest).
 *
 * `useCreateBoard` is exported rather than inlined because the Board-not-found
 * page offers the same button and must not implement creation a second time.
 */

import { useCallback, useState } from "react";
import { createBoard, type CreateBoardFn, type CreateBoardOutcome } from "../api";
import { boardPath } from "../routing";

export interface HomePageProps {
  /** Moves to another route (`useRoute().navigate`). */
  navigate: (pathname: string, options?: { replace?: boolean }) => void;
  /** Injectable for component tests, which must not hit a network. */
  create?: CreateBoardFn;
}

/**
 * "New board" as a hook, so the home page and the Board-not-found page share one
 * implementation: idle → creating → (navigated | failed with a message).
 *
 * The navigation happens inside the hook, so a caller cannot create a board and
 * forget to take the person to it.
 */
export function useCreateBoard({
  navigate,
  create = createBoard,
}: {
  navigate: HomePageProps["navigate"];
  create?: CreateBoardFn;
}) {
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = useCallback(async () => {
    setCreating(true);
    setFailed(false);

    // A creation that throws is the same to the person as one that answers a
    // failure: no board, and a message.
    let outcome: CreateBoardOutcome;
    try {
      outcome = await create();
    } catch {
      outcome = { ok: false, reason: "network" };
    }

    if (outcome.ok) {
      // `replace`, so Back from a board a person just created does not land back
      // on a home page whose button has already been used.
      navigate(boardPath(outcome.id), { replace: true });
      setCreating(false);
      return;
    }

    setCreating(false);
    setFailed(true);
  }, [create, navigate]);

  return { creating, failed, start };
}

export function HomePage({ navigate, create }: HomePageProps) {
  const { creating, failed, start } = useCreateBoard({ navigate, create });

  return (
    <main className="page page-home" data-testid="home-page">
      <header className="page-header">
        <h1 className="page-title">vidi6</h1>
        <p className="page-subtitle">A shared board for thinking together</p>
      </header>

      <div className="page-body">
        <button
          type="button"
          className="button button-primary"
          data-testid="new-board-button"
          onClick={() => void start()}
          disabled={creating}
        >
          {creating ? "Creating…" : "New board"}
        </button>

        {/* Only a failure speaks. A successful creation is the navigation. */}
        {failed && (
          <p className="form-error" role="alert" data-testid="create-error">
            Couldn&rsquo;t create a board. Please try again.
          </p>
        )}
      </div>
    </main>
  );
}
