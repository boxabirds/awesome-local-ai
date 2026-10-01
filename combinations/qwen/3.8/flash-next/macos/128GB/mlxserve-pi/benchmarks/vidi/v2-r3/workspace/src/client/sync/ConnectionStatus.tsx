// The badge that says how the connection is doing (design: `sync.react`).
//
// It is deliberately the least important thing on the screen: it takes up no
// space in the layout (absolutely positioned in the top bar) so it cannot push
// a note out of place, and it is not a button so it cannot steal a click meant
// for the board underneath it.
//
// What it says, and when it stops saying it, is the whole of its behaviour:
// "Connecting…" while there is no link yet, nothing while a link is up but the
// document is not agreed yet, "Reconnecting…" while the backoff is running, and
// "Connected" for CONNECTED_CONFIRMATION_MS after the room has agreed the
// document — after which it goes away and leaves the board alone.
import { useEffect, useRef, useState } from 'react';
import { CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import type { ConnectionState } from './connectBoard';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

export interface ConnectionStatusProps {
  state: ConnectionState;
  /** How long "Connected" stays up. Only a test needs to change it. */
  confirmationMs?: number;
}

export function ConnectionStatus({ state, confirmationMs = CONNECTED_CONFIRMATION_MS }: ConnectionStatusProps) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (state !== 'confirmed') {
      // Anything but a confirmed document: no "Connected" showing, and no
      // timer left waiting to hide it.
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setConfirming(false);
      return;
    }
    setConfirming(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setConfirming(false);
    }, confirmationMs);
    // Leaving, or moving to another state inside the window, leaves no timer
    // behind: this is the whole of the cleanup, and the only thing that makes
    // the badge disappear early.
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [state, confirmationMs]);

  if (state === 'connected') return null;
  if (state === 'confirmed' && !confirming) return null;

  return (
    <div
      className={`connection-status connection-status--${state === 'confirmed' ? 'confirmed' : 'pending'}`}
      data-state={state}
      role="status"
      aria-live="polite"
      data-testid="connection-status"
    >
      {LABELS[state]}
    </div>
  );
}
