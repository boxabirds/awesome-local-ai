// Connection badge (story 3, plus the story-4 load-failure message):
//   - "Connecting…" while the first sync has not happened
//   - hidden once synced
//   - amber "Reconnecting…" when the socket drops
//   - green "Connected" for CONNECTED_CONFIRMATION_MS after a reconnection
//   - red "This board couldn't be loaded. Retrying…" when the room reports a
//     load failure (story 4)

import { useEffect, useState } from 'react';
import type { WebsocketProvider } from 'y-websocket';
import { CONNECTED_CONFIRMATION_MS } from '../../shared/config';

type Badge = 'connecting' | 'hidden' | 'connected' | 'reconnecting';

export function ConnectionStatus({
  provider,
  loadFailed = false,
}: {
  provider: WebsocketProvider | null;
  loadFailed?: boolean;
}) {
  const [badge, setBadge] = useState<Badge>('connecting');

  useEffect(() => {
    if (!provider) return;
    let everSynced = provider.synced;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onSync = (): void => {
      if (everSynced) {
        setBadge('connected');
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setBadge('hidden'), CONNECTED_CONFIRMATION_MS);
      } else {
        everSynced = true;
        setBadge('hidden');
      }
    };
    const onStatus = (event: { status: string }): void => {
      if (event.status !== 'connected' && everSynced) setBadge('reconnecting');
    };

    provider.on('sync', onSync);
    provider.on('status', onStatus);
    return () => {
      if (timer) clearTimeout(timer);
      provider.off('sync', onSync);
      provider.off('status', onStatus);
    };
  }, [provider]);

  if (loadFailed) {
    return (
      <div className="connection-badge badge-error" role="status">
        This board couldn't be loaded. Retrying…
      </div>
    );
  }
  if (badge === 'hidden') return null;
  if (badge === 'connected') {
    return (
      <div className="connection-badge badge-ok" role="status">
        Connected
      </div>
    );
  }
  if (badge === 'reconnecting') {
    return (
      <div className="connection-badge badge-warn" role="status">
        Reconnecting…
      </div>
    );
  }
  return (
    <div className="connection-badge badge-neutral" role="status">
      Connecting…
    </div>
  );
}
