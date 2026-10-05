/**
 * Which page this window shows.
 *
 * The whole app is three pages and an address, so this file is a switch on the address and nothing
 * else. It is worth saying what is *not* here, because a top-level component in a product like this
 * usually carries something: there is no session to restore (a board's link is the only thing that
 * grants access to it, and the address in the bar is where that link arrives), no account to sign in
 * to (story 14's problem, and deliberately not this story's), and no list of this person's boards to
 * show them, because a board here has no owner who could be asked which ones they mean.
 *
 * Story 3 did have one piece of policy at this level: an address with no board id was given a
 * randomly generated one, so that anybody arriving at the site root landed on a board. That is gone,
 * and the reason is the thing this story is for. A board id made up in somebody's browser is not a
 * link — it cannot be sent to anybody, nothing remembers it, and closing the tab ends the board with
 * no notice given. Now the root is a home page that asks for a board from the service, which hands
 * back an address that outlives the tab it was made in.
 */
import type { JSX } from 'react';

import { useRoute } from './router';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App(): JSX.Element {
  const route = useRoute();

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      // Keyed by the id so that going from one board to another builds a new page rather than
      // rearranging the old one: a board document, its socket and its camera belong to one board, and
      // reusing them across a change of address would put one person's notes on another board's
      // screen while the new document was being asked for.
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
