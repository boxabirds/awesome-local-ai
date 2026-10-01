// src/client/pages/state.ts
// Page state machines for Home and Board pages.

import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';
import type { CheckResponse } from '../api';

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

export function nextBoardPageState(_state: BoardPageState, result: CheckResponse, attempt: number): BoardPageState {
  if (result.kind === 'exists') {
    // Need the boardId from the current state context
    // The caller provides it via the boardId prop
    return { kind: 'ready', boardId: '' }; // Will be overridden by caller
  }
  if (result.kind === 'not_found') {
    return { kind: 'not_found' };
  }
  // unreachable
  const backoff = Math.min(
    BOARD_CHECK_RETRY_BASE_MS * Math.pow(2, attempt - 1),
    RECONNECT_MAX_BACKOFF_MS
  );
  return { kind: 'unreachable', attempt, nextRetryMs: backoff };
}
