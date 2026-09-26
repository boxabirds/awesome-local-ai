import { deriveLiveUi } from './deriveLiveUi';
import { useLiveSnapshot } from './LiveProvider';
import { useNetworkStatus } from './useNetworkStatus';

export const RECONNECTING_TEXT = 'Reconnecting…';

/** Small pill while live updates have been down a while. Editing stays available (saves still work). */
export function ReconnectingPill() {
  const { status, pausedLong } = useLiveSnapshot();
  const { pill } = deriveLiveUi(status, pausedLong, useNetworkStatus());
  return pill ? (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-40 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm"
    >
      {RECONNECTING_TEXT}
    </div>
  ) : null;
}
