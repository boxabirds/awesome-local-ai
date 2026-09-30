import { navigate } from '../router';
import { NewBoardButton, useCreateBoard } from './HomePage';

/** Unknown or malformed board links (share.not_found): nothing is created at that address. */
export function NotFoundPage(): React.JSX.Element {
  const { state, create } = useCreateBoard();
  return (
    <main className="page">
      <h1 className="page-title">Board not found</h1>
      <p className="page-text">Check the link, or ask the person who shared it to send it again.</p>
      <NewBoardButton state={state} onCreate={create} />
      <a
        className="page-link"
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
