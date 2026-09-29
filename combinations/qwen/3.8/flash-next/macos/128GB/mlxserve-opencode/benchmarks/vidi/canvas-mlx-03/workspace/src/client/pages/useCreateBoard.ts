// The "create a board" action, shared by the two pages that offer it: the home
// page (PRD share.create) and Board not found (PRD share.not_found, which asks for
// "a link home and a way to create a board" — the most likely explanation of a dead
// link is that the visitor wants a board of their own).
//
// It lives in one place so the two entries cannot drift into two different create
// paths with two different rate-limit behaviours.

import { useState } from 'react';
import { requestNewBoard } from '../api.ts';
import { boardPath, navigateTo } from '../router.ts';

export const CREATE_FAILED = "Couldn't create a board. Please try again.";
export const RATE_LIMITED = "You're creating boards too quickly. Wait a minute and try again.";

export interface CreateBoardAction {
  /** A create request is in flight; the button is disabled while it is. */
  busy: boolean;
  /** The sentence to show under the button, or null while there is nothing to say. */
  error: string | null;
  create: () => Promise<void>;
}

export function useCreateBoard(): CreateBoardAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    // A second click while a create is in flight would spend another rate-limit
    // allowance on a board nobody asked for.
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await requestNewBoard();
    if (result.ok) {
      // The board page checks the link the way every entry does (share.open_link),
      // so even arriving from a create the board is confirmed before a canvas is
      // drawn.
      navigateTo(boardPath(result.boardId));
      return;
    }
    setBusy(false);
    setError(result.status === 429 ? RATE_LIMITED : CREATE_FAILED);
  }

  return { busy, error, create };
}
