import React from 'react';
import type { ConnectionState } from './connectBoard';

export interface ConnectionStatusProps {
  state: ConnectionState;
}

interface BadgeStyle {
  text: string;
  background: string;
  color: string;
}

function badgeFor(state: ConnectionState): BadgeStyle | null {
  switch (state) {
    case 'connecting':
      return { text: 'Connecting…', background: 'rgba(255,255,255,0.9)', color: '#555' };
    case 'reconnecting':
      // Amber: the connection is lost but the board stays editable.
      return { text: 'Reconnecting…', background: '#FFE082', color: '#5C4400' };
    case 'confirmed':
      // Green: a reconnection just succeeded; shown for CONNECTED_CONFIRMATION_MS.
      return { text: 'Connected', background: '#A5D6A7', color: '#1B3A1D' };
    case 'connected':
    default:
      return null;
  }
}

/**
 * Top-centre connection status badge.
 * Hidden while normally connected; visible for connecting / reconnecting /
 * post-reconnect confirmation. role="status" announces changes to screen readers.
 * The board remains fully editable in every state (this component never covers
 * or disables it — pointer-events are off).
 */
export function ConnectionStatus({ state }: ConnectionStatusProps) {
  const badge = badgeFor(state);
  if (!badge) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-status"
      data-state={state}
      style={{
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: badge.background,
        color: badge.color,
        borderRadius: '999px',
        padding: '6px 14px',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      {badge.text}
    </div>
  );
}
