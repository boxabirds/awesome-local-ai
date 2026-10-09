import type { ReactElement } from 'react';
import type { ConnectionState } from './connectBoard';

const COLORS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: '#3c4149',
  reconnecting: '#B26A00', // amber
  confirmed: '#1B7F3B', // green
};

/**
 * Connection status badge, top centre. Hidden while connected normally;
 * "Connecting…" on first load, amber "Reconnecting…" while disconnected,
 * green "Connected" for a short time after a reconnection.
 */
export function ConnectionStatus(props: { state: ConnectionState }): ReactElement | null {
  if (props.state === 'connected') return null;
  const text =
    props.state === 'connecting'
      ? 'Connecting…'
      : props.state === 'reconnecting'
        ? 'Reconnecting…'
        : 'Connected';
  return (
    <div
      role="status"
      className="connection-status"
      data-state={props.state}
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#fff',
        border: '1px solid #d5d9e0',
        borderRadius: 999,
        padding: '4px 14px',
        fontSize: 13,
        fontWeight: 500,
        color: COLORS[props.state],
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 30,
      }}
    >
      {text}
    </div>
  );
}
