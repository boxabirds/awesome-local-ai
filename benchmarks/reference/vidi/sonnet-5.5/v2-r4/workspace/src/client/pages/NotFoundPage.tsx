import { navigate } from '../router';
import { NewBoardButton } from './NewBoardButton';
import { pageStyle } from './useCreateBoard';

export function NotFoundPage() {
  return (
    <main style={pageStyle}>
      <h1 style={{ margin: 0, fontSize: 32 }}>Board not found</h1>
      <p style={{ margin: 0, color: '#455A64' }}>Check the link, or ask the person who shared it to send it again.</p>
      <NewBoardButton />
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
