import type { JSX } from 'react';
import type { ConnectionState } from './connectBoard';

/**
 * Story 3/4: connection status badge, top centre.
 *
 * - `connecting`   → "Connecting…"  (shown while first loading)
 * - `reconnecting` → "Reconnecting…" (amber)
 * - `confirmed`    → "Connected"    (green, shown briefly after a reconnect)
 * - `load_failed`  → red "This board couldn't be loaded. Retrying…"
 * - `connected`    → hidden (null)
 *
 * The board is editable in every state except `load_failed` (locked by App via
 * `canEdit`); the badge is informational and never intercepts pointer input.
 */
export const LOAD_FAILED_MESSAGE = "This board couldn't be loaded. Retrying…";

export function ConnectionStatus(props: { state: ConnectionState }): JSX.Element | null {
  const { state } = props;
  if (state === 'connected') return null;

  const text =
    state === 'connecting'
      ? 'Connecting…'
      : state === 'reconnecting'
        ? 'Reconnecting…'
        : state === 'load_failed'
          ? LOAD_FAILED_MESSAGE
          : 'Connected';

  const style: React.CSSProperties = {
    position: 'fixed',
    top: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10000,
    padding: '4px 12px',
    borderRadius: 9999,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'system-ui, sans-serif',
    pointerEvents: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
    ...(state === 'reconnecting'
      ? { background: '#F59E0B', color: '#1F1300' }
      : state === 'confirmed'
        ? { background: '#16A34A', color: '#FFFFFF' }
        : state === 'load_failed'
          ? { background: '#DC2626', color: '#FFFFFF' }
          : { background: '#6B7280', color: '#FFFFFF' }),
  };

  return (
    <div role="status" data-testid="connection-status" style={style} aria-live="polite">
      {text}
    </div>
  );
}
