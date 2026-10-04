/**
 * The home page: what somebody sees when they open vidi6 without a link
 * (share.home_page).
 *
 * Its whole job is to start the flow, so there is nothing to navigate and nothing to
 * catch up on — the board it shows is the one they are about to make. This is also
 * where story 3's "any address gets you a board of your own" behaviour ends: a board
 * is now made by asking, which is what makes every other address able to answer
 * "no such board" honestly (share.not_found).
 */

import { NewBoardButton } from './NewBoardButton';

export function HomePage() {
  return (
    <main className="page">
      <div className="page-card">
        <h1 className="page-title">vidi6</h1>
        <p className="page-tagline">A shared board for thinking together</p>
        <NewBoardButton />
        <p className="page-footnote">A board is opened by its link: share it with whoever you want on it.</p>
      </div>
    </main>
  );
}
