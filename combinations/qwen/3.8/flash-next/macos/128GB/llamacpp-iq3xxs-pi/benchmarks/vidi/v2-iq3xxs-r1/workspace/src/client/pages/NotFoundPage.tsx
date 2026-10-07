import { navigate } from '../router';
import { NewBoardButton } from './HomePage';
import { NOT_FOUND_HEADING, NOT_FOUND_MESSAGE } from './state';

/**
 * "Board not found" (PRD share.not_found): the link does not name a board this
 * service has storage for.
 *
 * The page says what happened and offers the two things that can help — a link back
 * to the home page, and the same New board button the home page has. It never guesses
 * that the board was deleted, and never shows a board that is not there: an empty
 * board where a missing one should be reported would tell the person the link was
 * right, which is the one thing that would not be true (TC-30).
 */
export function NotFoundPage() {
  return (
    <main className="page" data-testid="not-found-page">
      <div className="page-card">
        <h1>{NOT_FOUND_HEADING}</h1>
        <p className="page-lede">{NOT_FOUND_MESSAGE}</p>
        <NewBoardButton />
        <p className="page-note">
          {/* A real link, so "back to the home page" is also a keyboard route. */}
          <a
            href="/"
            data-testid="home-link"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            Go to the home page
          </a>
        </p>
      </div>
    </main>
  );
}
