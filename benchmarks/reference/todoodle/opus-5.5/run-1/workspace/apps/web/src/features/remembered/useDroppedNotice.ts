import { toast } from 'sonner';

export const DROPPED_NOTICE =
  "Your least recently opened workspace was removed from this browser's list. Its link still works.";

/**
 * Called from create/open success callbacks (an event path, never an effect). Shows the notice only
 * when remembering this workspace pushed the oldest one off this browser's capped list.
 */
export function notifyDropped(dropped: number): void {
  if (dropped > 0) toast(DROPPED_NOTICE);
}

/** Hook form for components; the returned function is the stable module-level notifyDropped. */
export function useDroppedNotice(): (dropped: number) => void {
  return notifyDropped;
}
