import type { ConnectionState } from './connectBoard';

const TEXT: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

/** Top-centre connection badge; hidden while connected normally. */
export function ConnectionStatus(props: { state: ConnectionState }) {
  if (props.state === 'connected') return null;
  return (
    <div className={`connection-status is-${props.state}`} role="status" data-state={props.state}>
      {TEXT[props.state]}
    </div>
  );
}
