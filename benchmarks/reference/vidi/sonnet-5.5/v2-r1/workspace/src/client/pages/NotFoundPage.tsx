import { navigate } from '../router';
import { NewBoardButton } from './NewBoardButton';

export function NotFoundPage() {
  return (
    <main className="page page--not-found">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <NewBoardButton />
      <p>
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          Back to the home page
        </a>
      </p>
    </main>
  );
}
