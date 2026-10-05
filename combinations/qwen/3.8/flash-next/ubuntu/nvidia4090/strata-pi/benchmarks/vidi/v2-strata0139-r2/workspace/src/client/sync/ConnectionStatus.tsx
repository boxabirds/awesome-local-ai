/**
 * The connection badge (`sync.client`).
 *
 * It reports one thing: whether this screen is in sync with the room. It is
 * `role="status"` so a screen reader announces a lost connection, it is amber
 * while the connection is down, green on its way back, and it is *absent* while
 * things are normal — a badge that is always on is decoration, not information.
 *
 * Whatever it says, the board stays editable: an offline client keeps typing
 * into its own `Y.Doc` and the changes merge when the connection returns.
 */

import type { ConnectionState } from "./connection-state";

export interface ConnectionStatusProps {
  state: ConnectionState;
}

const LABELS: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  confirmed: "Connected",
  connected: "Connected",
};

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  // `connected` is the normal state: nothing to report.
  if (state === "connected") return null;

  return (
    <div className={`connection-status connection-status--${state}`} role="status" aria-live="polite">
      {LABELS[state]}
    </div>
  );
}
