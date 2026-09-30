import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

/** Connection badge, top centre. Hidden while connected normally. */
export function ConnectionStatus(props: { state: ConnectionState }): React.JSX.Element | null {
  if (props.state === 'connected') return null;
  return (
    <div className={`connection-status connection-status--${props.state}`} role="status" data-state={props.state}>
      {LABELS[props.state]}
    </div>
  );
}
