import { deriveLiveUi } from './deriveLiveUi';
import { useLiveSnapshot } from './LiveProvider';
import { useNetworkStatus } from './network';
import { OfflineBanner } from './OfflineBanner';
import { ReconnectingPill } from './ReconnectingPill';

/**
 * The offline banner or the Reconnecting pill (never both). Its own component, so socket status
 * changes re-render only this and not the shell.
 */
export function LiveStatus() {
  const { status, pausedLong } = useLiveSnapshot();
  const { banner, pill } = deriveLiveUi(status, pausedLong, useNetworkStatus());
  return banner ? <OfflineBanner /> : pill ? <ReconnectingPill /> : null;
}
