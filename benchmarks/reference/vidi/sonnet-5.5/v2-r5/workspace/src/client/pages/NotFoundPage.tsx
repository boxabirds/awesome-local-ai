import { navigate } from '../router';
import { NewBoardButton } from './NewBoardButton';

export function NotFoundPage() {
  return (
    <main className="page">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <NewBoardButton />
      <a
        href="/"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate('/');
        }}
      >
        Back to home page
      </a>
    </main>
  );
}
