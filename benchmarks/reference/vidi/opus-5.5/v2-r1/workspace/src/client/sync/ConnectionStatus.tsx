import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

/** Connection badge, top centre. Hidden while normally connected. */
export function ConnectionStatus(props: { state: ConnectionState }) {
  if (props.state === 'connected') return null;
  return (
    <div className="connection-status" role="status" data-state={props.state}>
      {LABELS[props.state]}
    </div>
  );
}
