import * as React from 'react';
import type { CreateResponse } from '../api';
import { createBoardRequest } from '../api';
import { navigate, useRoute } from '../router';
import { BOARD_ID_PATTERN } from '../../shared/board-id';

/** A fresh board link contains a valid 22-char base64url id. */
const FRESH_BOARD_LINK = /^[A-Za-z0-9_-]{22}$/;

export function HomePage(): React.JSX.Element {
  const route = useRoute();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void route; // We handle navigation via click, not route changes

  const [buttonText, setButtonText] = React.useState<string>('New board');
  const [errorText, setErrorText] = React.useState<string | null>(null);

  const handleClick = React.useCallback(async () => {
    setButtonText('Creating…');
    setErrorText(null);

    const result = await createBoardRequest();

    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setButtonText('New board');
      setErrorText("Couldn't create a board. Please try again.");
    }
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        gap: '1rem',
      }}
    >
      <h1 style={{ fontSize: '2rem', margin: 0 }}>vidi6</h1>
      <p style={{ color: '#555' }}>A shared board for thinking together</p>
      <button
        onClick={handleClick}
        disabled={buttonText === 'Creating…'}
        aria-label="Create new board"
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1.1rem',
          cursor: buttonText === 'Creating…' ? 'not-allowed' : 'pointer',
          opacity: buttonText === 'Creating…' ? 0.6 : 1,
          border: 'none',
          borderRadius: '8px',
          backgroundColor: '#4F46E5',
          color: '#fff',
        }}
      >
        {buttonText}
      </button>
      {errorText && (
        <span
          role="alert"
          style={{ color: '#DC2626', fontSize: '0.9rem', marginTop: '-0.5rem' }}
        >
          {errorText}
        </span>
      )}
    </div>
  );
}
