import type { ReactElement } from 'react';
import type { ConnectionState } from './connectBoard';

export function ConnectionStatus({ state }: { state: ConnectionState }): ReactElement | null {
  if (state === 'connected') return null;

  if (state === 'connecting') {
    return (
      <div role="status" className="connection-badge connection-connecting">
        Connecting…
      </div>
    );
  }

  if (state === 'reconnecting') {
    return (
      <div role="status" className="connection-badge connection-reconnecting">
        Reconnecting…
      </div>
    );
  }

  if (state === 'confirmed') {
    return (
      <div role="status" className="connection-badge connection-confirmed">
        Connected
      </div>
    );
  }

  if (state === 'load_failed') {
    return (
      <div role="status" className="connection-badge connection-load-failed">
        This board couldn't be loaded. Retrying…
      </div>
    );
  }

  return null;
}
