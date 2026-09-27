import { toast } from 'sonner';

export const DROPPED_NOTICE =
  "Your least recently opened workspace was removed from this browser's list. Its link still works.";

/**
 * Tells the user their oldest remembered workspace fell off the list. Called from the create and
 * open success paths (event handlers, never an effect); does nothing when nothing was dropped.
 */
export function notifyDropped(dropped: number): void {
  if (dropped > 0) toast(DROPPED_NOTICE);
}
