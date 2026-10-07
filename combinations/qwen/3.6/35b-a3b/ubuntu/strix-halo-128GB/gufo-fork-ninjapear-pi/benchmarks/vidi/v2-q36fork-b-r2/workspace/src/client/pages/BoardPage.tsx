import * as React from 'react';
import { useRoute } from '../router';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard, type CheckResponse } from '../api';
import { nextBoardPageState, type BoardPageState } from './state';
import { HomePage } from './HomePage';
import { NotFoundPage } from './NotFoundPage';
import { BoardApp } from '../board/BoardApp';
import { SharePanel } from '../share/SharePanel';

// ---------------------------------------------------------------------------
// BoardPage — routing gate that validates board ID before showing the app
// ---------------------------------------------------------------------------

export function BoardPage(): React.JSX.Element {
  const route = useRoute();

  if (route.name === 'home') {
    return <HomePage />;
  }

  if (route.name === 'not_found') {
    return <NotFoundPage />;
  }

  // route.name === 'board'
  const { id: boardId } = route;

  // Malformed id → not found, no request sent
  if (!isValidBoardId(boardId)) {
    return <NotFoundPage />;
  }

  return <BoardPageImpl boardId={boardId} />;
}

// ---------------------------------------------------------------------------
// BoardPageImpl — existence check with retry when unreachable
// ---------------------------------------------------------------------------

function BoardPageImpl({ boardId }: { boardId: string }): React.JSX.Element {
  const [pageState, setPageState] = React.useState<BoardPageState>({ kind: 'checking' });
  const attemptRef = React.useRef(0);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear retry timer on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Check board existence
  React.useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const result = await checkBoard(boardId);
      if (cancelled) return;

      if (result.kind === 'exists') {
        setPageState({ kind: 'ready', boardId });
        return;
      }

      const nextState = nextBoardPageState(pageState, result, attemptRef.current);
      attemptRef.current++;
      setPageState(nextState);

      if (nextState.kind === 'unreachable') {
        timerRef.current = setTimeout(() => check(), nextState.nextRetryMs);
      }
    };

    check();
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [boardId]);

  // --- Render based on state ---

  switch (pageState.kind) {
    case 'checking':
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui' }}>
          Opening board…
        </div>
      );

    case 'not_found':
      return <NotFoundPage />;

    case 'unreachable':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui', gap: '0.5rem' }}>
          <p>Couldn't reach vidi6. Retrying…</p>
          <small style={{ color: '#888' }}>Attempt {pageState.attempt}</small>
        </div>
      );

    case 'ready':
      return <ReadyBoard boardId={boardId} />;
  }
}

/** 
 * Ready board — full board UI with Share panel.
 * This mirrors what the old App.tsx rendered, but without the redirect logic.
 */
function ReadyBoard({ boardId }: { boardId: string }): React.JSX.Element {
  const [shareOpen, setShareOpen] = React.useState(false);

  const boardLinkStr = `${window.location.origin}/b/${boardId}`;

  return (
    <>
      <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
        <BoardApp boardId={boardId} />
        
        {/* Share button (top-right) */}
        <button
          onClick={() => setShareOpen(true)}
          aria-label="Share board"
          style={{
            position: 'fixed',
            top: '10px',
            right: '10px',
            zIndex: 1000,
            padding: '8px 16px',
            border: '1px solid #ccc',
            borderRadius: '6px',
            background: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Share
        </button>
      </div>

      {/* Share panel overlay */}
      {shareOpen && (
        <SharePanel
          boardLink={boardLinkStr}
          onClose={() => setShareOpen(false)}
          onAfterCopy={() => {
            // After successful copy, we could close or show feedback
          }}
        />
      )}
    </>
  );
}
