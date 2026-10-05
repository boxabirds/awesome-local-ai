/**
 * Which page the address bar asks for. That is the whole component.
 *
 * Until story 5 this file *was* the board, and `/` meant "make a board and put its address
 * in the bar without a navigation", which was the only way a board could come into existence.
 * That made an address a claim a visitor could invent, so the board moved here — still the
 * centre of the product, one route among three — and what is left is the choice between home,
 * a board, and nowhere.
 *
 * The three pages share one document loaded from the Worker, which is what the Worker's asset
 * fallback exists for; nothing here knows how to fetch a board.
 */

import { type JSX } from 'react';
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
      /* Keyed by board id on purpose: two boards in one session are two boards, each with
         its own document, camera and connection. Reusing the instance would reuse the first
         board's document, and a person following a second link would find themselves looking
         at the first board with a new address in the bar (`share.link_stable`). */
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
