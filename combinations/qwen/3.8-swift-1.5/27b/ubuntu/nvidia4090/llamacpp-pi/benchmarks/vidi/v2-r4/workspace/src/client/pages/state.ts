import type { CheckResponse } from '../api';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config';

export type HomePageState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'create_failed'; message: "Couldn't create a board. Please try again." };

export type BoardPageState =
  | { kind: 'checking' }
  | { kind: 'ready'; boardId: string }
  | { kind: 'not_found' }
  | { kind: 'unreachable'; attempt: number; nextRetryMs: number };

export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  boardId: string,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable': {
      const baseMs = BOARD_CHECK_RETRY_BASE_MS;
      const nextRetryMs = Math.min(baseMs * Math.pow(2, attempt - 1), RECONNECT_MAX_BACKOFF_MS);
      return { kind: 'unreachable', attempt, nextRetryMs };
    }
  }
}
