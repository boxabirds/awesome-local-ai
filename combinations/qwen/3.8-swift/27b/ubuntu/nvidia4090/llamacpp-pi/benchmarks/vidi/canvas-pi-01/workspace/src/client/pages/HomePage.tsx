// Home page (spec: share.pages): product name, one-line description, Create a
// board button and the create-failure messages.

import { useCreateBoard } from '../actions/createAction';

export function HomePage() {
  const { state, create } = useCreateBoard();
  return (
    <div className="page home-page">
      <h1 className="home-title">vidi6</h1>
      <p className="home-tagline">A shared board for thinking together</p>
      <button
        className="primary-button"
        onClick={() => void create()}
        disabled={state === 'creating'}
      >
        {state === 'creating' ? 'Creating…' : 'Create a board'}
      </button>
      {state === 'create_failed' && (
        <p className="form-error" role="alert">
          Couldn&apos;t create a board. Please try again.
        </p>
      )}
      {state === 'rate_limited' && (
        <p className="form-error" role="alert">
          You&apos;re creating boards too quickly. Wait a minute and try again.
        </p>
      )}
    </div>
  );
}
