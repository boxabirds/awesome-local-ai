/** Connection status badge for story 3 */

interface ConnectionStatusProps {
  state: 'connecting' | 'connected' | 'reconnecting' | 'confirmed';
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
    default:
      text = '';
      color = '#666';
      borderColor = '#ccc';
  }

  return (
    <div
      role="status"
      aria-label={`Connection status: ${text}`}
      style={{
        position: 'fixed',
        top: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        padding: '4px 12px',
        borderRadius: '4px',
        fontSize: '13px',
        fontWeight: 500,
        backgroundColor: 'white',
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
