// The badge state machine. It turns coarse y-websocket provider signals into the
// four visible badge states and runs the CONNECTED_CONFIRMATION_MS timer that
// hides the transient "Connected" confirmation after a reconnect.
//
//   connecting --(first open+sync)--> connected (hidden)
//   connected  --(socket closed)-----> reconnecting
//   reconnecting --(open+sync)-------> confirmed ("Connected", green)
//   confirmed --(CONNECTED_CONFIRMATION_MS)--> connected (hidden)
//   confirmed --(socket closed again)--> reconnecting (immediately)

import { useEffect, useRef, useState } from 'react';
import { CONNECTED_CONFIRMATION_MS } from '../../shared/config.ts';

export type ProviderSignal = 'connecting' | 'connected' | 'disconnected';

export type ConnectionStatusValue = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';

/** Subscribe to provider signals; returns an unsubscribe function. */
export type Subscribe = (emit: (signal: ProviderSignal) => void) => () => void;

export function useConnectionBadge(subscribe: Subscribe, enabled = true): ConnectionStatusValue {
  const [status, setStatus] = useState<ConnectionStatusValue>(enabled ? 'connecting' : 'connected');
  const everConnected = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setStatus('connected');
      return;
    }
    const unsubscribe = subscribe((signal: ProviderSignal) => {
      if (signal === 'connected') {
        if (!everConnected.current) {
          everConnected.current = true;
          setStatus('connected');
        } else {
          setStatus('confirmed');
        }
      } else if (signal === 'disconnected') {
        setStatus('reconnecting');
      }
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
