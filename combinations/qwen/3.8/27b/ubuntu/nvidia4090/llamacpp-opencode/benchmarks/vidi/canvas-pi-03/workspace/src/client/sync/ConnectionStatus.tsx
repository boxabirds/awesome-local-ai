import { useEffect, useRef, useState } from 'react';
import { CONNECTED_CONFIRMATION_MS } from '@/shared/config';
import type { ConnectionState } from './connectBoard';

/**
 * Live-connection status badge (story 3).
 *
 * Renders a `role="status"` pill while the connection is establishing or
 * being re-established, and hides once it is stable. The "Connected"
 * confirmation after a reconnection is visible for exactly
 * CONNECTED_CONFIRMATION_MS (driven by a real timer so the component test
 * can assert the boundary with fake timers).
 */
const LABELS: Partial<Record<ConnectionState, string>> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirmed: 'Connected',
};

const DOT_COLOR: Partial<Record<ConnectionState, string>> = {
  connecting: '#90CAF9',
  reconnecting: '#FFB74D',
  confirmed: '#81C784',
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const [showConfirmed, setShowConfirmed] = useState(false);
  const prevRef = useRef<ConnectionState>(state);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (state === 'confirmed' && prev !== 'confirmed') {
      setShowConfirmed(true);
      const t = setTimeout(() => setShowConfirmed(false), CONNECTED_CONFIRMATION_MS);
      return () => clearTimeout(t);
    }
    if (state !== 'confirmed') {
      setShowConfirmed(false);
    }
  }, [state]);

  const label = state === 'confirmed' ? (showConfirmed ? LABELS.confirmed : null) : LABELS[state];
  if (label === null || label === undefined) return null;

  return (
    <div
      role="status"
      data-testid="connection-status"
      data-state={state}
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        padding: '6px 12px',
        borderRadius: 16,
        fontSize: 13,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: DOT_COLOR[state] ?? '#90CAF9',
          display: 'inline-block',
        }}
      />
      {label}
    </div>
  );
}
