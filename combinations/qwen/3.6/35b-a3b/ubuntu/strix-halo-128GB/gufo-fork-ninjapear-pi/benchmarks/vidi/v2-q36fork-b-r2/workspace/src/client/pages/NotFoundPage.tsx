import * as React from 'react';
import { navigate } from '../router';

/** Board not found page — shown for unknown or malformed board links. */
export function NotFoundPage(): React.JSX.Element {
  const handleNewBoard = () => {
    navigate('/');
  };

  const handleGoHome = () => {
    navigate('/');
  };

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
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Board not found</h2>
      <p style={{ color: '#555', maxWidth: '400px', lineHeight: '1.6' }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        onClick={handleNewBoard}
        aria-label="Create new board"
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          cursor: 'pointer',
          border: 'none',
          borderRadius: '8px',
          backgroundColor: '#4F46E5',
          color: '#fff',
        }}
      >
        New board
      </button>
      <a
        href="/"
        onClick={(e) => { e.preventDefault(); handleGoHome(); }}
        style={{ color: '#4F46E5', textDecoration: 'underline' }}
      >
        Go back to the home page
      </a>
    </div>
  );
}
