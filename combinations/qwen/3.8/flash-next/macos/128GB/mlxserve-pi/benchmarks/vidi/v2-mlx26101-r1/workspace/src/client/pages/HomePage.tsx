// The home page (share.create): the product name, one line about what this is, and
// the New board button. Nothing else — in particular no board and no connection, so
// opening `/` never joins a room or writes any storage.
//
// Clicking New board is the only way a board comes into existence here; when it
// succeeds the address bar becomes `/b/<link>`, which is the link the Share panel
// then hands to somebody else.

import type { JSX } from 'react';
import { NewBoardButton } from './NewBoardButton';

/** The one line under the product name. */
export const HOME_TAGLINE = 'A shared board for thinking together.';

export function HomePage(): JSX.Element {
  return (
    <main className="home-page" data-testid="home-page">
      <div className="home-card">
        <h1 className="home-title">vidi6</h1>
        <p className="home-tagline">{HOME_TAGLINE}</p>
        <NewBoardButton className="home-new-board" />
      </div>
    </main>
  );
}
