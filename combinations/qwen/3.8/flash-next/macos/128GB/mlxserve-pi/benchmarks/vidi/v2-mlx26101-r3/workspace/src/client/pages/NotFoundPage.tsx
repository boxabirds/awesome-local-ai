import type { JSX } from 'react';
import { liveApi, type BoardApi } from '../api';
import { NewBoardButton } from './NewBoardButton';

export interface NotFoundPageProps {
  /** The board the address named, when it named one at all. */
  boardId?: string;
  /** What to ask the service with, if the person decides to ask for a board instead. */
  api?: BoardApi;
}

/**
 * The page for a link that leads nowhere.
 *
 * The wording matters more here than anywhere else on the client. A person arriving at this page
 * has usually just been told by the service that a board they were looking for is not there, and
 * the two things they are afraid of - that the board was deleted, and that they are the kind of
 * person who loses things - are both answered by the same honest sentence: the link is the only
 * way in, and a link with one character wrong is a different link. It does not say the board was
 * deleted, because nothing knows that; and it does not apologise, because nothing went wrong.
 *
 * What it does offer is a way out that does not go through the same link twice: a board of their
 * own, which is the same wish the home page makes, and a way back to the home page for anybody who
 * would rather look at a button they already know.
 */
export function NotFoundPage({ boardId, api = liveApi }: NotFoundPageProps): JSX.Element {
  return (
    <main className="page" data-testid="not-found-page">
      <h1 className="page__title">Board not found</h1>
      <p className="page__lede">Check the link, or ask the person who shared it to send it again.</p>
      {boardId === undefined ? null : <p className="page__code">{boardId}</p>}
      <NewBoardButton api={api} />
      <a className="page__link" href="/" data-testid="home-link">
        Go to the home page
      </a>
    </main>
  );
}
