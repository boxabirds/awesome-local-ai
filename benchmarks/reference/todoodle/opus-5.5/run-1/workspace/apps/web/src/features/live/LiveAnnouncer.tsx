import { useSyncExternalStore } from 'react';
import { announcer } from './announcer';

/**
 * Visually hidden polite live region for other people's changes. Mounted once per workspace view.
 * Each announcement gets a fresh node (keyed by seq), so a repeated message is announced again.
 */
export function LiveAnnouncer() {
  const { message, seq } = useSyncExternalStore(announcer.subscribe, announcer.getSnapshot);
  return (
    <div role="status" aria-live="polite" aria-label="Changes by others" className="sr-only">
      {message ? <span key={seq}>{message}</span> : null}
    </div>
  );
}
