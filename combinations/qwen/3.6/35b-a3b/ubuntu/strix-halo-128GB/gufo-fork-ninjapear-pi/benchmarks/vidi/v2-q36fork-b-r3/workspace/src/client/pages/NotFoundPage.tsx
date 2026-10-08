import React from 'react';
import { navigate } from '../router';

export function NotFoundPage() {
  const handleNewBoard = () => navigate('/');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#f8f9fa',
      }}
    >
      <h2 style={{ fontSize: 24, marginBottom: 12 }}>Board not found</h2>
      <p style={{ color: '#666', marginBottom: 32, textAlign: 'center', maxWidth: 400 }}>
        Check the link, or ask the person who shared it to send it again.
      </p>

      <button
        onClick={handleNewBoard}
        aria-label="New board"
        style={{
          padding: '12px 32px',
          fontSize: 16,
          fontWeight: 600,
          border: 'none',
          borderRadius: 8,
          background: '#2563eb',
          color: '#fff',
          cursor: 'pointer',
          marginBottom: 16,
        }}
      >
        New board
      </button>

      <br />

      <a
        href="/"
        style={{
          color: '#2563eb',
          textDecoration: 'none',
          fontSize: 14,
        }}
      >
        Back to home page
      </a>
    </div>
  );
}
