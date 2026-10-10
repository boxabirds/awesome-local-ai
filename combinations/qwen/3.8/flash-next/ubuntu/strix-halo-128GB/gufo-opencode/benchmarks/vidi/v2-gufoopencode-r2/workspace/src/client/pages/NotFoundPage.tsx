// Story 5 (share.pages, share.not_found): "Board not found". Never creates
// anything by itself; offers the same New board action as Home and a link
// back home.

import { navigate } from '../router';
import { NewBoardButton } from './HomePage';

export function NotFoundPage() {
  return (
    <main className="page not-found-page">
      <h1>Board not found</h1>
      <p>
        This link does not point to a board. Check the address, or start a new
        board and share its link.
      </p>
      <NewBoardButton />
      <p>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          Go to vidi6 home
        </a>
      </p>
    </main>
  );
}
