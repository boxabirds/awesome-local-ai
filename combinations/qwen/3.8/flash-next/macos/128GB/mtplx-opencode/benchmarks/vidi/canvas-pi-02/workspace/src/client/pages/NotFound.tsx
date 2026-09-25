/**
 * The "Board not found" page (story 5, task 1.4).
 *
 * It replaces both former states — "truncated link, this board is yours alone"
 * and "Board not found" — with one honest screen, and it never opens a socket.
 * A short id and an unresolvable one get the same page because the outcome is
 * the same: there is no board here, and nothing is created at that address
 * (`share.not_found`).
 *
 * The PRD gives one sentence for this page, so it is one sentence here too,
 * with the tried address shown beneath it: someone who lost three characters in
 * Slack needs to *see* the address to notice, and a field they can select beats
 * a paragraph they have to compare by eye.
 */
import { useState } from 'react';
import { createBoard, type CreateOutcome } from '../api';
import { HOME_TEXT } from './Home';

export interface NotFoundPageProps {
  /** Why we are here: a bad link, or a real id that did not resolve. */
  reason: 'malformed' | 'missing' | 'unreachable';
  /** The path the visitor tried, shown back to them for a truncated link. */
  attempted?: string;
  /** Create navigation, injected for tests. */
  go?: (href: string) => void;
  /** The create call, injected so a test can answer instantly. */
  create?: () => Promise<CreateOutcome>;
}

/** The PRD's copy for this page, verbatim. */
export const NOT_FOUND_TEXT = {
  title: 'Board not found',
  lead: 'Check the link, or ask the person who shared it to send it again.',
  create: 'Create a new board',
  home: 'Back to the home page',
} as const;

/**
 * The full address that was tried, for the field beneath the message.
 *
 * Only shown for a malformed link: a well-formed id that does not resolve has
 * nothing to check, and showing it would just repeat the message.
 */
export function attemptedLink(origin: string, attempted: string): string {
  return `${origin}${attempted}`;
}

export function NotFoundPage({
  reason,
  attempted,
  go = (href) => {
    if (typeof window !== 'undefined') window.location.assign(href);
  },
  create = () => createBoard(),
}: NotFoundPageProps) {
  const [failed, setFailed] = useState(false);

  const start = async (): Promise<void> => {
    const outcome = await create();
    // Only a real id leads away; a failure or a 429 stays on the page, where
    // the button still works.
    if (outcome.status === 'created') {
      go(`/b/${outcome.id}`);
      return;
    }
    setFailed(true);
  };

  const showField = reason === 'malformed' && attempted !== undefined;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <main className="page not-found-page" data-testid="not-found-page">
      <div className="page-card">
        <h1 className="page-title">{NOT_FOUND_TEXT.title}</h1>
        <p className="page-lead" data-testid="not-found-advice">
          {NOT_FOUND_TEXT.lead}
        </p>
        {showField ? (
          <p className="link-line">
            <span className="link-line-label">The address you opened</span>
            <input
              readOnly
              value={attemptedLink(origin, attempted ?? '')}
              aria-label="Board link"
              data-testid="share-link"
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              ref={(node) => node?.select()}
            />
          </p>
        ) : null}
        <button
          type="button"
          className="primary-button"
          data-testid="create-board"
          onClick={() => void start()}
        >
          {NOT_FOUND_TEXT.create}
        </button>
        <p className="page-links">
          <a href="/" data-testid="home-link">
            {NOT_FOUND_TEXT.home}
          </a>
        </p>
        {failed ? (
          <p className="page-note" data-testid="create-failed" role="status">
            {HOME_TEXT.failed}
          </p>
        ) : null}
      </div>
    </main>
  );
}
