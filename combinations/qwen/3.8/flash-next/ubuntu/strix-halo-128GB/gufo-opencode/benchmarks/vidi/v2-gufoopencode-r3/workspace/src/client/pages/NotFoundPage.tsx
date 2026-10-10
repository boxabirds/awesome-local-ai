import { NewBoardButton } from './NewBoardButton';
import { navigate } from '../router';

export function NotFoundPage() {
  return (
    <main className="page not-found-page">
      <h1 className="not-found-title">Board not found</h1>
      <p className="not-found-text">
        Check the link, or ask the person who shared it to send it again.
      </p>
      <NewBoardButton className="new-board-button" />
      <p>
        <a
          className="home-link"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          Back to home
        </a>
      </p>
    </main>
  );
}
