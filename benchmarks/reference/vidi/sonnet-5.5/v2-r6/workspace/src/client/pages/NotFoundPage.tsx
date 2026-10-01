import { navigate } from '../router';
import { NewBoardButton, useCreateBoard } from './HomePage';

export function NotFoundPage() {
  const { state, create } = useCreateBoard();
  return (
    <main className="page page--not-found">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <NewBoardButton state={state} create={create} />
      <a
        href="/"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate('/');
        }}
      >
        Back to the home page
      </a>
    </main>
  );
}
