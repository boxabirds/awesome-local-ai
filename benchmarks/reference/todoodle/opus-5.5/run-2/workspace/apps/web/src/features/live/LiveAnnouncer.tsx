import { useSyncExternalStore } from 'react';
import { useLive } from './LiveProvider';

const empty = { message: '', seq: 0 };
const noopSubscribe = () => () => {};

/**
 * Visually hidden polite live region for others' changes. Mounted once in the workspace shell;
 * keyed on the announcement so a repeated message is announced again.
 */
export function LiveAnnouncer() {
  const live = useLive();
  const announcement = useSyncExternalStore(
    live?.announcer.subscribe ?? noopSubscribe,
    live?.announcer.getSnapshot ?? (() => empty),
    live?.announcer.getSnapshot ?? (() => empty),
  );
  return (
    <div role="status" aria-live="polite" className="sr-only" data-testid="live-announcer">
      {announcement.message ? <span key={announcement.seq}>{announcement.message}</span> : null}
    </div>
  );
}
