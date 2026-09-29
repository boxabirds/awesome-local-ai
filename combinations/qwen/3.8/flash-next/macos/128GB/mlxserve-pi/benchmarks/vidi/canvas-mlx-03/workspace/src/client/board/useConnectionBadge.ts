// The badge state machine. It turns coarse y-websocket provider signals into the
// visible badge states and runs the CONNECTED_CONFIRMATION_MS timer that hides
// the transient "Connected" confirmation after a reconnect.
//
//   connecting --(first open+sync)--> connected (hidden)
//   connected  --(socket closed)-----> reconnecting
//   reconnecting --(open+sync)-------> confirmed ("Connected", green)
//   confirmed --(CONNECTED_CONFIRMATION_MS)--> connected (hidden)
//   confirmed --(socket closed again)--> reconnecting (immediately)
//
// Story 4 adds `load_failed`: the room said it cannot read this board's storage
// (close code CLOSE_BOARD_LOAD_FAILED). It is sticky — a further drop, or the
// retry backoff running, never clears it — and only a successful sync clears it,
// straight back to a plain connected board (no green confirmation, no reload).

import { useEffect, useRef, useState } from 'react';
import { CONNECTED_CONFIRMATION_MS } from '../../shared/config.ts';

/**
 * Every state the connection can be in (design `persist.client_status`).
 * `load_failed` is the only state in which the board may not be edited.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'confirmed'
  | 'load_failed';

/** Name used by story 1–3 imports; identical to {@link ConnectionState}. */
export type ConnectionStatusValue = ConnectionState;

/**
 * Coarse provider signals fed into the machine, plus story 4's `load-failed`
 * (produced from a close code by `connectBoard`'s `closeCodeToSignal`).
 */
export type ProviderSignal = 'connecting' | 'connected' | 'disconnected' | 'load-failed';

/** Subscribe to provider signals; returns an unsubscribe function. */
export type Subscribe = (emit: (signal: ProviderSignal) => void) => () => void;

export function useConnectionBadge(
  subscribe: Subscribe,
  enabled = true,
  initial?: ConnectionState,
): ConnectionState {
  const [status, setStatus] = useState<ConnectionState>(
    initial ?? (enabled ? 'connecting' : 'connected'),
  );
  const everConnected = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setStatus('connected');
      return;
    }
    const unsubscribe = subscribe((signal: ProviderSignal) => {
      if (signal === 'load-failed') {
        setStatus('load_failed');
        return;
      }
      setStatus((prev) => {
        if (signal === 'connected') {
          // The first successful load, or the recovery from a load failure, is a
          // plain connected board: the editing gates lift without a confirmation.
          if (!everConnected.current || prev === 'load_failed') {
            everConnected.current = true;
            return 'connected';
          }
          return 'confirmed';
        }
        if (signal === 'disconnected') {
          // A dropped socket says nothing about whether the board is loadable; if
          // we already know it is not, keep saying so.
          return prev === 'load_failed' ? 'load_failed' : 'reconnecting';
        }
        return prev;
      });
    });
    return unsubscribe;
  }, [subscribe, enabled]);

  useEffect(() => {
    if (status !== 'confirmed') return;
    const t = setTimeout(() => setStatus('connected'), CONNECTED_CONFIRMATION_MS);
    return () => clearTimeout(t);
  }, [status]);

  return status;
}
