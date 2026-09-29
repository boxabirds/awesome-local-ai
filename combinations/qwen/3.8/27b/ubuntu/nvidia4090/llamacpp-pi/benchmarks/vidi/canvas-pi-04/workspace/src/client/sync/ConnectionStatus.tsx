// Story 3: the live badge (PRD live.badge).
//
// Hidden while the board is connected; otherwise shows the current phase:
// "Connecting…" (initial), "Reconnecting…" (drop after having been live),
// "Connected" (green confirmation for CONNECTED_CONFIRMATION_MS after a
// resync). role="status" announces changes to screen readers; the badge is
// pointer-transparent and never locks out the board.

import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
  // load_failed: the room closed us with 4500 — the board could not be
  // loaded. The provider keeps retrying; the first successful sync clears
  // the badge (PRD persist.badge). Rendered red via [data-state="load_failed"].
  load_failed: "This board couldn't be loaded. Retrying…",
};

export function ConnectionStatus(props: { state: ConnectionState }): JSX.Element | null {
  if (props.state === 'connected') return null;
  return (
    <div className="connection-status" role="status" data-state={props.state}>
      {LABELS[props.state]}
    </div>
  );
}
