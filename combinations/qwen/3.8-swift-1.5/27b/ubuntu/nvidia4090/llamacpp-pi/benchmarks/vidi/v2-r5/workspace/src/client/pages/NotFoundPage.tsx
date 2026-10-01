// src/client/pages/NotFoundPage.tsx
// Board not found page.

import { useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';

export function NotFoundPage(): ReactElement {
  const [state, setState] = useState<'idle' | 'creating' | 'failed'>('idle');

  const handleCreate = useCallback(async () => {
    setState('creating');
    const result = await createBoardRequest();
    if (result.kind === 'created') {
      navigate(`/b/${result.id}`);
    } else {
      setState('failed');
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>Board not found</h1>
      <p style={{ color: '#555', marginBottom: '2rem' }}>Check the link, or ask the person who shared it to send it again.</p>
      <button
        onClick={handleCreate}
        disabled={state === 'creating'}
        style={{
          fontSize: '1.1rem',
          padding: '0.75rem 2rem',
          cursor: state === 'creating' ? 'not-allowed' : 'pointer',
          opacity: state === 'creating' ? 0.7 : 1,
          marginBottom: '1rem',
        }}
      >
        {state === 'creating' ? 'Creating…' : 'New board'}
      </button>
      {state === 'failed' && (
        <p style={{ color: '#c00', marginBottom: '1rem' }}>Couldn't create a board. Please try again.</p>
      )}
      <a
        href="/"
        style={{ color: '#06c', textDecoration: 'underline' }}
      >
        Back to home
      </a>
    </div>
  );
}
