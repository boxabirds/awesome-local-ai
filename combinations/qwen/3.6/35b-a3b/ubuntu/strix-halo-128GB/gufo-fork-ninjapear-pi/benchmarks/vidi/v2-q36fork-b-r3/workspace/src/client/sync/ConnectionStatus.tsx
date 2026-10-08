/** Connection status badge — includes story 4 load-failure handling */

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

interface ConnectionStatusProps {
  state: ConnectionState;
}

export function ConnectionStatus({ state }: ConnectionStatusProps): any {
  if (state === 'connected') {
    return null; // Hidden when normally connected
  }

  let text: string;
  let color: string;
  let borderColor: string;

  switch (state) {
    case 'connecting':
      text = 'Connecting\u2026';
      color = '#666';
      borderColor = '#ccc';
      break;
    case 'reconnecting':
      text = 'Reconnecting\u2026';
      color = '#D4A017';
      borderColor = '#D4A017';
      break;
    case 'confirmed':
      text = 'Connected';
      color = '#2E7D32';
      borderColor = '#2E7D32';
      break;
    case 'load_failed':
      text = 'This board could not be loaded. Retrying\u2026';
      color = '#C62828';
      borderColor = '#C62828';
      break;
    default:
      text = '';
      color = '#666';
      borderColor = '#ccc';
  }

  const isLoadFailed = state === 'load_failed';

  return (
    <div
      role="status"
      aria-label={isLoadFailed ? 'Error' : `Connection status: ${text}`}
      style={{
        position: 'fixed',
        top: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        padding: isLoadFailed ? '6px 16px' : '4px 12px',
        borderRadius: '4px',
        fontSize: isLoadFailed ? '13px' : '13px',
        fontWeight: 500,
        backgroundColor: isLoadFailed ? '#ffebee' : 'white',
        color,
        border: `1px solid ${borderColor}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        userSelect: 'none',
      }}
    >
      {text}
    </div>
  );
}
