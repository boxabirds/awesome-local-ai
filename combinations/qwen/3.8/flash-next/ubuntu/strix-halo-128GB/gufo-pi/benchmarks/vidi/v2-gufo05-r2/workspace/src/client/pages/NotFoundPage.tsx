/**
 * "Board not found" (share.not_found_page).
 *
 * Shown when an address names a board that does not exist. The two things a person
 * needs here are what happened and what to do, and the honest version of the first is
 * short: nobody created a board at this address. The usual reasons — a link typed
 * wrong, a link a chat app cut short — are worth saying because they can be fixed,
 * and because "it was deleted" would be a promise this product does not make: there is
 * no API that removes a board (board.close).
 *
 * Deliberately absent: any hint that the board might come back, and any attempt to
 * guess which board was meant. Guessing would land somebody on a stranger's board,
 * which is the failure this story exists to avoid.
 */

import { NewBoardButton } from './NewBoardButton';
import { navigate } from '../router';

export function NotFoundPage() {
  return (
    <main className="page" data-testid="not-found-page">
      <div className="page-card">
        <h1 className="page-title">Board not found</h1>
        <p className="page-tagline">Check the link, or ask the person who shared it to send it again.</p>
        <NewBoardButton />
        {/* A way out that is not "make something": the home page is where they were
            before the link, and it creates nothing to look at it. */}
        <p className="page-footnote">
          <button type="button" className="link-button" data-testid="home-link" onClick={() => navigate('/')}>
            Back to the home page
          </button>
        </p>
      </div>
    </main>
  );
}
