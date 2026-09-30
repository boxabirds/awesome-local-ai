// Copyright 2026 Board Room contributors. All rights reserved.
//
// The one piece of UI this story adds: what the connection is doing. It never
// blocks the board — while it says "Reconnecting…" the person can keep typing
// and dragging, and the edits go into the local document (`live.status`).
//
// Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
import type { ReactNode } from 'react';
import type { ConnectionState } from './connectBoard';

/** Amber, for a connection that is down and retrying. */
export const RECONNECTING_COLOR = '#b45309';
/** Green, for a connection that just caught up (and is holding). */
export const CONNECTED_COLOR = '#15803d';

const LABELS: Record<Exclude<ConnectionState, 'connected'>, string> = {
  connecting: 'Connecting\u2026',
  reconnecting: 'Reconnecting\u2026',
  confirmed: 'Connected',
};

const chipStyle = (state: ConnectionState): Record<string, string | number> => ({
  position: 'fixed',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 40,
  padding: '4px 10px',
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.92)',
  border: '1px solid rgba(0, 0, 0, 0.12)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)',
  fontSize: 13,
  lineHeight: '18px',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  color: state === 'reconnecting' ? RECONNECTING_COLOR : CONNECTED_COLOR,
  pointerEvents: 'none',
});

/**
 * The connection badge, top centre of the screen: "Connecting\u2026" during the
 * first load, amber "Reconnecting\u2026" while a connection is lost and being
 * retried, green "Connected" for CONNECTED_CONFIRMATION_MS after a recovery.
 * While everything is fine it renders nothing at all: a working connection is
 * not worth a pixel of the board.
 */
export function ConnectionStatus({ state }: { state: ConnectionState }): ReactNode {
  if (state === 'connected') return null;
  return (
    <div
      data-testid="connection-status"
      data-state={state}
      role="status"
      aria-live="polite"
      style={chipStyle(state)}
    >
      {LABELS[state]}
    </div>
  );
}
