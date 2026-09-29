// Board page (share.pages).
//
// Owns the "is this board real?" check and its outcomes:
//
//   * malformed id          → Board not found, NO request sent (TC-19);
//   * valid but unknown id  → Board not found (TC-20);
//   * valid + existing board→ the stories 1–4 board + the Share panel, mounted
//     ONLY once the existence check succeeded (so we never open a provider, or
//     let anyone edit, against a board that does not exist);
//   * unreachable service   → "Couldn't reach vidi6. Retrying…" with exponential
//     backoff from BOARD_CHECK_RETRY_BASE_MS capped at RECONNECT_MAX_BACKOFF_MS;
//     it retries on its own and the board appears WITHOUT a reload (TC-21/28).
//
// The check and the backoff run through injectable seams (`check`, `setTimeout`
// /`clearTimeout`) so the whole machine is testable with fake timers and a
// mocked `api.ts`. Timers are cleared on unmount.

import { type ReactElement, useEffect, useReducer, useRef } from 'react';
import { checkBoard, type CheckResponse } from '../api';
import { isValidBoardId } from '../../shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import { App } from '../App';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';

type Phase =
  | { name: 'checking' }
  | { name: 'unreachable' }
  | { name: 'ready'; exists: boolean };

export interface BoardPageDeps {
  /** Override the existence call (component tests). Defaults to `checkBoard`. */
  check?: (id: string) => Promise<CheckResponse>;
  setTimeout?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface BoardPageProps extends BoardPageDeps {
  id: string;
}

export function BoardPage(props: BoardPageProps): ReactElement {
  const { id, check = checkBoard, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout } = props;
  const valid = isValidBoardId(id);
  // Single piece of state: the phase. `checking` is the initial value for a
  // valid id; a malformed id starts already "not found".
  const [phase, rerender] = useReducer(
    (_prev: Phase, next: Phase) => next,
    valid ? { name: 'checking' as const } : { name: 'ready' as const, exists: false },
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!valid) return; // not-found path: no request, no timers (TC-19)
    let cancelled = false;
    let attempt = 0;

    const runCheck = async () => {
      // A retry that was already unreachable keeps its message; the very first
      // check shows "Opening board…".
      if (attempt === 0) rerender({ name: 'checking' });
      const result = await check(id);
      if (cancelled) return;
      if (result.kind === 'exists') {
        rerender({ name: 'ready', exists: true });
        return;
      }
      if (result.kind === 'not_found') {
        rerender({ name: 'ready', exists: false });
        return;
      }
      // unreachable → backoff retry (doubles, capped at RECONNECT_MAX_BACKOFF).
      rerender({ name: 'unreachable' });
      const delay = Math.min(BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt, RECONNECT_MAX_BACKOFF_MS);
      attempt += 1;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!cancelled) void runCheck();
      }, delay);
    };

    void runCheck();
    return () => {
      cancelled = true;
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [id, valid]);

  if (!valid) return <NotFoundPage />;
  if (phase.name === 'checking') {
    return (
      <div data-testid="opening-board" role="status">
        Opening board…
      </div>
    );
  }
  if (phase.name === 'unreachable') {
    return (
      <div data-testid="unreachable-board" role="status">
        Couldn't reach vidi6. Retrying…
      </div>
    );
  }
  if (!phase.exists) return <NotFoundPage />;
  return (
    <div data-testid="board-page" className="board-page">
      <SharePanel boardId={id} />
      <App boardId={id} />
    </div>
  );
}
