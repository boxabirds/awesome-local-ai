import type { ConnectionState } from './connectBoard';

export function ConnectionStatus(props: { state: ConnectionState }) {
  const { state } = props;

  if (state === 'connected') {
    return null;
  }

  if (state === 'connecting') {
    return (
      <div
        role="status"
        aria-label="Connecting"
        style={{
          position: 'fixed',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '4px 12px',
          borderRadius: 4,
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
          background: '#e0e0e0',
          color: '#333',
          zIndex: 10000,
        }}
      >
        Connecting…
      </div>
    );
  }

  if (state === 'reconnecting') {
    return (
      <div
        role="status"
        aria-label="Reconnecting"
        style={{
          position: 'fixed',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '4px 12px',
          borderRadius: 4,
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
          background: '#FFC107',
          color: '#333',
          zIndex: 10000,
        }}
      >
        Reconnecting…
      </div>
    );
  }

  if (state === 'confirmed') {
    return (
      <div
        role="status"
        aria-label="Connected"
        style={{
          position: 'fixed',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '4px 12px',
          borderRadius: 4,
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
          background: '#4CAF50',
          color: '#fff',
          zIndex: 10000,
        }}
      >
        Connected
      </div>
    );
  }

  return null;
}
