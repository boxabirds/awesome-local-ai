// Connection status badge (top centre). Visible for every state except
// `connected`; green while `confirmed`, amber while `reconnecting`,
// neutral while `connecting`.

import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

const LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export function ConnectionStatus({ state }: { state: ConnectionState }): JSX.Element | null {
  if (state === 'connected') return null;
  return (
    <div
      role="status"
      data-testid="connection-status"
      className={`connection-status connection-status--${state}`}
    >
      {LABELS[state]}
    </div>
  );
}
