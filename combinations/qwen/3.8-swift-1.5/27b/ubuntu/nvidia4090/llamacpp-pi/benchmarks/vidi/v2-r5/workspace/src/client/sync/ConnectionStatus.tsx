// src/client/sync/ConnectionStatus.tsx
// Connection status badge: top centre, shows state transitions.

import type { ReactElement } from 'react';
import type { ConnectionState } from './connectBoard';

export function ConnectionStatus(props: { state: ConnectionState }): ReactElement | null {
  const { state } = props;

  if (state === 'connected') {
    return null;
  }

  let text: string;
  let color: string;

  switch (state) {
    case 'connecting':
      text = 'Connecting…';
      color = '#666';
      break;
    case 'reconnecting':
      text = 'Reconnecting…';
      color = '#F5A623';
      break;
    case 'confirmed':
      text = 'Connected';
      color = '#4CAF50';
      break;
    default:
      return null;
  }

  return (
    <div
      role="status"
      data-testid="connection-status"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        padding: '4px 12px',
        borderRadius: 4,
        fontSize: 13,
        fontWeight: 500,
        color: '#fff',
        background: color,
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      {text}
    </div>
  );
}
