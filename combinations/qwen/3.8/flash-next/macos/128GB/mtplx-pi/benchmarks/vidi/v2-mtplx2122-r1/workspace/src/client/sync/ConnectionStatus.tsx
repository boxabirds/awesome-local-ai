/**
 * Connection status badge (capability `sync.client`, design `live.status`).
 *
 * Top-centre badge. Visible while the board is not fully synced:
 * "Connecting…" during the first load, amber "Reconnecting…" while the
 * connection is down, green "Connected" for the confirmation window after a
 * reconnect. Hidden when `state === 'connected'`. It never blocks input: the
 * board stays editable in every state.
 */

import type { ConnectionState } from './connectBoard'

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
}

const COLORS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: '#666666',
  reconnecting: '#B26A00', // amber
  confirmed: '#1B7F3B', // green
}

const BACKGROUNDS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'rgba(0,0,0,0.06)',
  reconnecting: 'rgba(255,179,0,0.18)',
  confirmed: 'rgba(46,160,67,0.18)',
}

export interface ConnectionStatusProps {
  state: ConnectionState
}

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  if (state === 'connected') return null
  const label = LABELS[state]
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-status"
      data-state={state}
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        color: COLORS[state],
        background: BACKGROUNDS[state],
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {label}
    </div>
  )
}

export default ConnectionStatus
