import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { navigate } from '../router';
import { NewBoardControl } from './HomePage';

/**
 * The Board not found page (share.not_found): a mistyped, truncated or made-up
 * link comes here, and nothing was created on the way. It offers the same way in
 * as home — a New board button — and a link back to home, so a bad link is a
 * dead end only for that board, never for the product.
 */

const NOT_FOUND_HEADING = 'Board not found';
const NOT_FOUND_TEXT = 'Check the link, or ask the person who shared it to send it again.';

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  textAlign: 'center',
  padding: 24,
};

const homeLinkStyle: CSSProperties = { color: '#4A90D9', fontSize: 14 };

export function NotFoundPage(): ReactNode {
  const goHome = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    navigate('/');
  };

  return (
    <main style={pageStyle}>
      <h1 data-testid="not-found-heading" style={{ fontSize: 32, margin: 0 }}>
        {NOT_FOUND_HEADING}
      </h1>
      <p data-testid="not-found-text" style={{ fontSize: 16, opacity: 0.75, margin: 0 }}>
        {NOT_FOUND_TEXT}
      </p>
      <NewBoardControl />
      <a data-testid="home-link" href="/" style={homeLinkStyle} onClick={goHome}>
        Back to vidi6 home
      </a>
    </main>
  );
}
