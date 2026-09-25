/**
 * The Home page (story 5, task 1.4).
 *
 * One purpose: a single "Create a board" button that makes a board and takes
 * you into it within the create budget. The id is made on the server
 * (`POST /api/boards`), never guessed here, so a mistyped address cannot fork
 * somebody else's board. A 429 (too many boards) and a failure are both
 * reported on the page rather than navigated away from, because the person is
 * meant to be able to press the button again.
 *
 * The wording is the PRD's, verbatim, and it lives in {@link HOME_TEXT} so the
 * component tests can assert the whole string without retyping it.
 */
import { useCallback, useRef, useState } from 'react';
import { createBoard, type CreateOutcome } from '../api';

/** The exact PRD copy, in one place so it can be asserted verbatim. */
export const HOME_TEXT = {
  title: 'vidi6',
  lead: 'A shared board for thinking together',
  create: 'Create a board',
  creating: 'Creating\u2026',
  failed: "Couldn't create a board. Please try again.",
  limited: "You're creating boards too quickly. Wait a minute and try again.",
} as const;

/** Where a created board's link points, without a leading slash. */
export function newBoardHref(boardId: string): string {
  return `/b/${boardId}`;
}

export interface HomePageProps {
  /** The create call, injected so a test can answer instantly. */
  create?: () => Promise<CreateOutcome>;
  /** Navigation, injected so a test can watch the route without a browser. */
  go?: (href: string) => void;
}

type HomeStatus =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'limited' }
  | { phase: 'failed' };

/** The whole page. `data-testid`s are shared with the e2e specs. */
export function HomePage({
  create = () => createBoard(),
  go = (href) => {
    if (typeof window !== 'undefined') window.location.assign(href);
  },
}: HomePageProps) {
  const [status, setStatus] = useState<HomeStatus>({ phase: 'idle' });
  // One create at a time: a double-click must not ask for two boards.
  const busy = useRef(false);

  const onCreate = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus({ phase: 'creating' });
    try {
      const outcome = await create();
      if (outcome.status === 'created') {
        go(newBoardHref(outcome.id));
        return;
      }
      // Either way the button comes back: a failed create is something to
      // retry, not a dead end.
      setStatus(outcome.status === 'rate_limited' ? { phase: 'limited' } : { phase: 'failed' });
    } finally {
      busy.current = false;
    }
  }, [create, go]);

  return (
    <main className="page home-page" data-testid="home-page">
      <div className="page-card">
        <h1 className="page-title">{HOME_TEXT.title}</h1>
        <p className="page-lead">{HOME_TEXT.lead}</p>
        <button
          type="button"
          className="primary-button"
          data-testid="create-board"
          disabled={status.phase === 'creating'}
          onClick={() => void onCreate()}
        >
          {status.phase === 'creating' ? HOME_TEXT.creating : HOME_TEXT.create}
        </button>
        {status.phase === 'limited' ? (
          <p className="page-note" data-testid="create-limited" role="status">
            {HOME_TEXT.limited}
          </p>
        ) : null}
        {status.phase === 'failed' ? (
          <p className="page-note" data-testid="create-failed" role="status">
            {HOME_TEXT.failed}
          </p>
        ) : null}
      </div>
    </main>
  );
}
