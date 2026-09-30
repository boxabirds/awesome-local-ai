import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { RECONNECT_MAX_BACKOFF_MS, CONNECTED_CONFIRMATION_MS } from '../../shared/config';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (s: ConnectionState) => void,
): { destroy(): void } {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  const url = `${protocol}://${host}/api/rooms`;

  const provider = new WebsocketProvider(url, boardId, doc, {
    maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
    disableBc: true,
  });

  let hasConnected = false;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;

  const handleStatus = () => {
    if (confirmationTimer !== null) {
      clearTimeout(confirmationTimer);
      confirmationTimer = null;
    }

    // y-websocket's WebsocketProvider has status and sync at runtime
    // but they're not in the TypeScript type definitions
    const p = provider as unknown as { status: string; sync: boolean };

    if (p.status === 'connected' && p.sync) {
      if (hasConnected) {
        onState('confirmed');
        confirmationTimer = setTimeout(() => {
          onState('connected');
          confirmationTimer = null;
        }, CONNECTED_CONFIRMATION_MS);
      } else {
        hasConnected = true;
        onState('connected');
      }
    } else if (p.status === 'disconnected' && hasConnected) {
      onState('reconnecting');
    } else if (p.status === 'connected' && !p.sync) {
      if (!hasConnected) {
        onState('connecting');
      }
    } else if (p.status === 'connecting') {
      if (!hasConnected) {
        onState('connecting');
      } else {
        onState('reconnecting');
      }
    }
  };

  provider.on('status', handleStatus);
  provider.on('sync', handleStatus);

  // Initial state
  onState('connecting');

  return {
    destroy() {
      if (confirmationTimer !== null) {
        clearTimeout(confirmationTimer);
        confirmationTimer = null;
      }
      provider.off('status', handleStatus);
      provider.off('sync', handleStatus);
      provider.destroy();
    },
  };
}
