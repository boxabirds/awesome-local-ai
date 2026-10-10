import { navigate } from '../router';
import { NewBoardButton } from './HomePage';

/**
 * The Board not found page (`share.not_found`).
 *
 * One sentence, and two ways out: follow the link back to the home page, or make
 * a new board right here. It never claims the board was deleted - the server only
 * ever says "there is nothing at this address".
 */
export function NotFoundPage() {
  return (
    <main className="page page--not-found" data-testid="not-found-page">
      <h1 className="page__title">Board not found</h1>
      <p className="page__lead">
        The link you followed does not match a board here. Check it, or start a new board.
      </p>
      <NewBoardButton />
      <a
        className="page__link"
        href="/"
        data-testid="home-link"
        onClick={(event) => {
          event.preventDefault();
          navigate('/');
        }}
      >
        Go to the home page
      </a>
    </main>
  );
}
