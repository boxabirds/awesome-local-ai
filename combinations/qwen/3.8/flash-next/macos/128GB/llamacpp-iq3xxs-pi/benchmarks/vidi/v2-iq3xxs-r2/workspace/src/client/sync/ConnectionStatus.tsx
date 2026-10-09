import { useEffect, useState, type JSX } from 'react';
import { CONNECTED_CONFIRMATION_MS } from '../../shared/config';
import type { ConnectionState } from './connectBoard';

/** Exact UI text (PRD: amber 'Reconnecting…', green 'Connected', 'Connecting…' on first load). */
export const CONNECTING_LABEL = 'Connecting…';
export const RECONNECTING_LABEL = 'Reconnecting…';
export const CONNECTED_LABEL = 'Connected';
/** Story 4: the board itself could not be loaded. Red, and it says so (exact PRD text). */
export const LOAD_FAILED_LABEL = 'This board couldn\'t be loaded. Retrying…';
export const CONNECTION_STATUS_LABEL = 'Connection status';

/**
 * The badge, top centre. Nothing about the wire is explained while the board is working
 * — `connected` renders nothing at all — and `confirmed` is a moment of green that ends
 * by itself: after `CONNECTED_CONFIRMATION_MS` it hides, so coming back from an outage
 * says the thing once instead of shouting it.
 */
export function ConnectionStatus({ state }: { state: ConnectionState }): JSX.Element | null {
  if (state === 'connected') return null;
  if (state === 'confirmed') return <Confirmation />;
  if (state === 'load_failed') return <Badge tone="bad" text={LOAD_FAILED_LABEL} />;
  return <Badge tone="pending" text={state === 'connecting' ? CONNECTING_LABEL : RECONNECTING_LABEL} />;
}

/** Green, and only for a moment. Re-entering `confirmed` mounts this again, timer and all. */
function Confirmation(): JSX.Element | null {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShown(false), CONNECTED_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return <Badge tone="ok" text={CONNECTED_LABEL} />;
}

function Badge({ tone, text }: { tone: 'pending' | 'ok' | 'bad'; text: string }): JSX.Element {
  return (
    <div
      role="status"
      aria-label={CONNECTION_STATUS_LABEL}
      className={`vidi6-connection-status vidi6-connection-status--${tone}`}
      data-testid="connection-status"
    >
      {text}
    </div>
  );
}
