/**
 * Page state types and the state machine for BoardPage's existence check.
 */
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

/**
 * Computes the next BoardPageState from a CheckResponse and the current attempt number.
 *
 * - exists → ready
 * - not_found → not_found
 * - unreachable → unreachable with exponential backoff (base * 2^attempt, capped)
 */
export function nextBoardPageState(
  _state: BoardPageState,
  result: CheckResponse,
  attempt: number,
  retryBaseMs: number,
  maxBackoffMs: number,
): BoardPageState {
  switch (result.kind) {
    case 'exists':
      return { kind: 'ready', boardId: '' }; // caller fills boardId
    case 'not_found':
      return { kind: 'not_found' };
    case 'unreachable': {
      const nextRetryMs = Math.min(retryBaseMs * Math.pow(2, attempt), maxBackoffMs);
      return { kind: 'unreachable', attempt: attempt + 1, nextRetryMs };
    }
  }
}
