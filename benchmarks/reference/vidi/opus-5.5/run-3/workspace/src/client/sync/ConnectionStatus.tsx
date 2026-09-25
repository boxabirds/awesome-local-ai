import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

/** Top-centre connection badge. Hidden while connected normally; never blocks editing. */
export function ConnectionStatus(props: { state: ConnectionState }) {
  if (props.state === 'connected') return null;
  return (
    <div
      className={`connection-status connection-status--${props.state}`}
      role="status"
      aria-label="Connection status"
      data-state={props.state}
    >
      {LABELS[props.state]}
    </div>
  );
}
