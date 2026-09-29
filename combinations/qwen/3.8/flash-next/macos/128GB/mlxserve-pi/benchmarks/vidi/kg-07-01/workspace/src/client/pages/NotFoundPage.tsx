import { navigate } from '../router';
import { CreateBoardButton } from './HomePage';

export function NotFoundPage() {
  return (
    <main className="page">
      <h1 className="page__title">Board not found</h1>
      <p className="page__text">Check the link, or ask the person who shared it to send it again.</p>
      <CreateBoardButton label="Create a new board" />
      <a
        className="page__link"
        href="/"
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          navigate('/');
        }}
      >
        Go to the home page
      </a>
    </main>
  );
}
