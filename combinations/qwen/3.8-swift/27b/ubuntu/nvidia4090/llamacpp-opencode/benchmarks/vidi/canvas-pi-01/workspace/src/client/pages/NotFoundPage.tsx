// Board not found page (spec: share.pages): shown for unknown boards and for
// malformed board addresses (no request is sent in the latter case). The
// "Create a new board" button reuses HomePage's create action.

import { useCreateBoard } from '../actions/createAction';
import { navigate } from '../router';

export function NotFoundPage() {
  const { state, create } = useCreateBoard();
  return (
    <div className="page not-found-page">
      <h1 className="page-title">Board not found</h1>
      <p className="page-text">
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        className="primary-button"
        onClick={() => void create()}
        disabled={state === 'creating'}
      >
        {state === 'creating' ? 'Creating…' : 'Create a new board'}
      </button>
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
    </div>
  );
}
