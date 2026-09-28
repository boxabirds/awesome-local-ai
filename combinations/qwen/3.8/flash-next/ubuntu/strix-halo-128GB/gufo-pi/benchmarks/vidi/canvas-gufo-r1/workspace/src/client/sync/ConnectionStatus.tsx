import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * Connection status badge. Hidden when state is 'connected'.
 * - 'connecting': "Connecting…"
 * - 'reconnecting': amber "Reconnecting…"
 * - 'confirmed': green "Connected"
 * - 'load_failed': red "This board couldn't be loaded. Retrying…"
 */
export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null;

  let className = 'connection-status';
  let text = '';

  switch (state) {
    case 'connecting':
      className += ' connection-status--connecting';
      text = 'Connecting…';
      break;
    case 'reconnecting':
      className += ' connection-status--reconnecting';
      text = 'Reconnecting…';
      break;
    case 'confirmed':
      className += ' connection-status--confirmed';
      text = 'Connected';
      break;
    case 'load_failed':
      className += ' connection-status--load-failed';
      text = "This board couldn't be loaded. Retrying…";
      break;
  }

  return (
    <div className={className} role="status" aria-label={text} data-testid="connection-status">
      {text}
    </div>
  );
}
