import type { JSX } from 'react';

import { NewBoardButton } from './NewBoardButton';

/**
 * The home page: one thing to do.
 *
 * There is no list of boards, and no board is shown here — a board is a link, and
 * the only way to get one is to make it (share.board_api). A person who comes here
 * by accident has the same button.
 */
export function HomePage(): JSX.Element {
  return (
    <main className="page home-page" data-testid="home-page">
      <h1 className="page-title">vidi6</h1>
      <p className="page-lead">
        A board of sticky notes you can share. Start one, then send somebody the link — anyone with
        the link is on the same board, and nobody else is.
      </p>
      <NewBoardButton />
      <p className="page-note">
        A board&apos;s link is its only access control, so it is worth not posting in public.
      </p>
    </main>
  );
}
