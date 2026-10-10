import { useState } from 'react';
import { createBoardRequest } from '../api';
import { navigate } from '../router';
import { CREATE_FAILED_MESSAGE } from './state';

// Self-contained "New board" action: creating state, failure message and
// navigation on success. Shared by the home and not-found pages (share.pages).
export function NewBoardButton({ className }: { className?: string }) {
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);

  const create = async () => {
    if (creating) return;
    setFailed(false);
    setCreating(true);
    let createdId: string | null = null;
    try {
      const result = await createBoardRequest();
      if (result.kind === 'created') createdId = result.id;
    } catch {
      createdId = null; // defensive: treat a thrown request as a failure
    }
    if (createdId !== null) {
      // Navigates away; this component unmounts with the page.
      navigate(`/b/${createdId}`);
      return;
    }
    setCreating(false);
    setFailed(true);
  };

  return (
    <>
      <button
        type="button"
        className={className ?? 'new-board-button'}
        onClick={create}
        disabled={creating}
      >
        {creating ? 'Creating…' : 'New board'}
      </button>
      {failed && (
        <p className="create-error" role="alert">
          {CREATE_FAILED_MESSAGE}
        </p>
      )}
    </>
  );
}
