/**
 * Board not found page.
 * Story 5 — share a board with others using a link.
 */
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { navigate } from '../router';

interface NotFoundPageProps {
  onCreateBoard?: () => void;
}

export function NotFoundPage(props: NotFoundPageProps): ReactNode {
  const handleNewBoard = useCallback(() => {
    if (props.onCreateBoard) {
      props.onCreateBoard();
    } else {
      navigate('/');
    }
  }, [props]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
      padding: '2rem',
    }}>
      <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', color: '#343a40' }}>
        Board not found
      </h2>
      <p style={{ color: '#6c757d', marginBottom: '2rem', maxWidth: '400px' }}>
        Check the link, or ask the person who shared it to send it again.
      </p>
      <button
        onClick={handleNewBoard}
        data-testid="new-board-btn"
        style={{
          padding: '12px 32px',
          fontSize: '1rem',
          fontWeight: 600,
          border: 'none',
          borderRadius: '8px',
          background: '#007bff',
          color: '#fff',
          cursor: 'pointer',
          marginBottom: '1rem',
        }}
        aria-label="New board"
      >
        New board
      </button>
      <br />
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          color: '#007bff',
          cursor: 'pointer',
          textDecoration: 'underline',
          fontSize: '0.9rem',
        }}
      >
        Back to home
      </button>
    </div>
  );
}
