import type { StoreFaults, StoreStep } from './board-store';

/**
 * Storage failures a test can ask for, by board.
 *
 * A disk that gives out cannot be scheduled, so a test asks for the failure at a named point
 * instead: the room hands its store a controller that consults this table before each piece
 * of its own work, and a test names a board, a point and how many times it should fail. The
 * statement itself is never patched, which is what makes a failed compaction a real rollback
 * rather than a simulation of one.
 *
 * Nothing in production arms a fault - only the tests import these functions - and a room
 * whose board has no faults armed gets the controller that lets everything through.
 */

/** How many more times each (board, point) should fail. */
const remaining = new Map<string, Map<StoreStep, number>>();

/** Make the named point fail for this board, `times` times (every time if infinite). */
export function armStoreFault(boardId: string, step: StoreStep, times = 1): void {
  const perStep = remaining.get(boardId) ?? new Map<StoreStep, number>();
  perStep.set(step, (perStep.get(step) ?? 0) + times);
  remaining.set(boardId, perStep);
}

/** Forget any fault armed for this board. */
export function clearStoreFaults(boardId: string): void {
  remaining.delete(boardId);
}

/** How many failures are still owed for this board and point (0 when none). */
export function storeFaultCount(boardId: string, step: StoreStep): number {
  return remaining.get(boardId)?.get(step) ?? 0;
}

/** The controller a board's store should consult. Throws when a fault is armed. */
export function storeFaultsFor(boardId: string): StoreFaults {
  return {
    hit(step: StoreStep): void {
      const perStep = remaining.get(boardId);
      const left = perStep?.get(step) ?? 0;
      if (left <= 0) {
        return;
      }
      if (left === 1) {
        perStep?.delete(step);
      } else if (Number.isFinite(left)) {
        perStep?.set(step, left - 1);
      }
      // The message a real SQLite failure would not have said any differently.
      throw new Error(`injected storage failure at ${step}`);
    },
  };
}
