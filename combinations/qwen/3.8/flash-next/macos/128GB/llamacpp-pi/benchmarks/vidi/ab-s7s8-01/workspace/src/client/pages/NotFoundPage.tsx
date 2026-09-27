// Board-not-found page (share.not_found).
//
// Shown for a malformed id (no request sent) and for a valid id the service
// reports as unknown. It offers "Create a new board" (the SAME create action as
// the home page) and a link back to the home page. Opening an unknown link
// never creates a board at that address.

import { type ReactElement } from 'react';
import { CreateBoardButton } from './HomePage';
import { navigate } from '../router';

export function NotFoundPage(): ReactElement {
  return (
    <main data-testid="not-found-page">
      <h1>Board not found</h1>
      <p>Check the link, or ask the person who shared it to send it again.</p>
      <CreateBoardButton label="Create a new board" />
      <p>
        <a
          href="/"
          data-testid="home-link"
          onClick={(event) => {
            // Same-origin SPA navigation without a reload.
            if (event.metaKey || event.ctrlKey) return;
            event.preventDefault();
            navigate('/');
          }}
        >
          Back to the home page
        </a>
      </p>
    </main>
  );
}
