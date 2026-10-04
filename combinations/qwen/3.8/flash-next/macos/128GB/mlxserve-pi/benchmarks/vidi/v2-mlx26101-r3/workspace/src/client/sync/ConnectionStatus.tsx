import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import type { ConnectionState } from './connectBoard';

/**
 * What the badge shows, which is not exactly what the connection does: the badge stops
 * showing "Connected" after a while, whereas the connection just stays connected.
 */
type Phase = 'connecting' | 'reconnecting' | 'confirming' | 'load_failed' | 'hidden';

const LABELS: Record<Exclude<Phase, 'hidden'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirming: 'Connected',
  load_failed: "This board couldn't be loaded. Retrying…",
};

/** The connection's state as the badge would show it, before the confirmation timer ran. */
function phaseFor(state: ConnectionState, wasInterrupted: boolean): Phase {
  switch (state) {
    case 'connected':
      // A connection that came back is announced; one that was never lost is not.
      return wasInterrupted ? 'confirming' : 'hidden';
    case 'confirmed':
      return 'confirming';
    case 'reconnecting':
      return 'reconnecting';
    case 'connecting':
      return 'connecting';
    case 'load_failed':
      // Not a phase the connection goes through on the way anywhere: it is the board being
      // unreadable, and it stays on screen until the board is not.
      return 'load_failed';
  }
}

export interface ConnectionStatusProps {
  state: ConnectionState;
}

/**
 * The little message at the top of the board that says what the connection is doing.
 *
 * While a connection is lost it says "Reconnecting…" in amber and the board underneath stays
 * exactly as usable as it was: every edit still goes into the document, and the room gets it
 * when the connection comes back. When it has come back the message says "Connected" for
 * {@link CONNECTED_CONFIRMATION_MS} and then disappears, so that being connected - the normal
 * state of a board - is the only state that takes up no room on screen.
 *
 * A board that could not be loaded is the exception, and is shown in red for as long as it
 * lasts: what is on screen is not known to be the board, so the tab says so instead of
 * carrying on as if nothing had happened. It says "Retrying" because it is - the room reads
 * the board again, and when it succeeds this message goes away by itself.
 *
 * The confirmation message is shown on the way *back*, and a state that arrives as
 * `connected` straight after an interruption counts as the way back just as much as one that
 * announces itself as `confirmed`.
 */
export function ConnectionStatus({ state }: ConnectionStatusProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>(() => phaseFor(state, false));

  useEffect(() => {
    setPhase((current) =>
      phaseFor(state, current === 'reconnecting' || current === 'confirming' || current === 'load_failed'),
    );
  }, [state]);

  useEffect(() => {
    if (phase !== 'confirming') {
      return;
    }
    const timer = setTimeout(() => {
      setPhase('hidden');
    }, CONNECTED_CONFIRMATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [phase]);

  if (phase === 'hidden') {
    return null;
  }

  return (
    <div
      className={`connection-status connection-status--${phase}`}
      data-testid="connection-status"
      role="status"
    >
      {LABELS[phase]}
    </div>
  );
}
