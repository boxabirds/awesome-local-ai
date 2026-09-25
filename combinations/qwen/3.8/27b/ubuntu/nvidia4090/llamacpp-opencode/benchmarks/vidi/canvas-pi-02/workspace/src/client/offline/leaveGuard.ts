/**
 * Leave guard (story 13, offline.status_ui).
 *
 * Guards page close/reload when changes are unsynced AND the device
 * cannot store them.
 */
import type { Availability } from './localBoardStore';

export function shouldGuard(input: { availability: Availability; unsynced: boolean }): boolean {
  return input.availability === 'unavailable' && input.unsynced;
}

/**
 * Install a beforeunload guard. Returns an uninstall function.
 * The handler calls preventDefault() and sets returnValue only when
 * shouldGuard is true at the time of the event.
 */
export function installLeaveGuard(
  get: () => { availability: Availability; unsynced: boolean },
): () => void {
  const handler = (e: BeforeUnloadEvent) => {
    const { availability, unsynced } = get();
    if (shouldGuard({ availability, unsynced })) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}
