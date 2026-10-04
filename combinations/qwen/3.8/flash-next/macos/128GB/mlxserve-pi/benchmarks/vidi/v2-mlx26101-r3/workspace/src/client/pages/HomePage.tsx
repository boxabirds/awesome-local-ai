import type { JSX } from 'react';
import { liveApi, type BoardApi } from '../api';
import { NewBoardButton } from './NewBoardButton';

export interface HomePageProps {
  /** What to ask the service with. Tests hand this a set of prepared answers. */
  api?: BoardApi;
}

/**
 * The page at `/`: one question - "shall we make a board?" - and the answer to it.
 *
 * A board is not made by arriving any more; it is made by asking, and the address it comes back
 * with is the thing the person then shares. That is the whole of this page, which is why it has
 * nothing else on it: a page that also offered a name, a colour or a template would be a page that
 * had to explain the difference between a board you are looking at and a board you made.
 */
export function HomePage({ api = liveApi }: HomePageProps): JSX.Element {
  return (
    <main className="page" data-testid="home-page">
      <h1 className="page__title">vidi6</h1>
      <p className="page__lede">A shared board for thinking together.</p>
      <NewBoardButton api={api} />
    </main>
  );
}
