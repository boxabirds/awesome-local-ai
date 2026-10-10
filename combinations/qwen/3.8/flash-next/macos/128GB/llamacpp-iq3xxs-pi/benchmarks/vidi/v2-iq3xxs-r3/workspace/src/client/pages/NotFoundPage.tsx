import type { JSX } from 'react';

import { NewBoardButton } from './NewBoardButton';

/**
 * There is no board at this address (share.not_found).
 *
 * The copy is not the standard error page's "not found": a person who got here has
 * a link in their hand and no way to know whether the link is wrong, or the board
 * was never made, so it says those two things and offers the way out — the same
 * **New board** button the home page has.
 *
 * Nothing here touches the board: no board, no canvas, no toolbar, no request.
 */
export function NotFoundPage({ path }: { readonly path: string }): JSX.Element {
  return (
    <main className="page not-found" data-testid="not-found">
      <h1 className="page-title">Board not found</h1>
      <p className="page-lead">
        The link is wrong or this board was never made. Double-check the link, or start a new board
        and share that.
      </p>
      {/* The path is shown because it is the thing the person needs to check, and
          it is only ever their own address bar. */}
      <p className="not-found-path" data-testid="not-found-path">
        {path}
      </p>
      <NewBoardButton />
      <a className="page-link" href="/" data-testid="home-link">
        Back to vid-6
      </a>
    </main>
  );
}
