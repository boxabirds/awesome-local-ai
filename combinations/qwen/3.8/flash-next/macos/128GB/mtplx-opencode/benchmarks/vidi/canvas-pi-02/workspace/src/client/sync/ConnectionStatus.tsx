/**
 * The connection badge (story 3).
 *
 * One line of text that tells the truth about the link: three states are
 * visible, and the healthy one is not. A board whose connection is fine shows
 * nothing, because a whiteboard is not supposed to have a status bar; the
 * badge exists only for the moment it doesn't.
 *
 * `role="status"` makes the same announcement for screen readers. The element
 * is replaced between states rather than re-styled in place, so each new
 * message is announced, and `data-state` gives the tests a stable hook.
 */
import { createElement, useMemo, useSyncExternalStore, type JSX } from 'react';
import type { BoardConnection, ConnectionState } from './connectBoard';

/** What each state says. `connected` says nothing, on purpose. */
const LABELS: Record<ConnectionState, string | null> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  confirming: 'Connected',
  connected: null,
};

/** The badge itself. It is never a control, so nothing can be locked out. */
export function ConnectionStatus({ state }: { state: ConnectionState }): JSX.Element | null {
  const label = LABELS[state];
  if (label === null) return null;
  return createElement(
    'div',
    {
      className: `connection-status connection-status--${state}`,
      role: 'status',
      'data-testid': 'connection-status',
      'data-state': state,
    },
    label,
  );
}

/** A `useSyncExternalStore` pair that keeps its identity per connection. */
function storeFor(connection: BoardConnection | null): {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ConnectionState;
} {
  if (connection === null) {
    // No connection at all (an offline document) reads as a healthy one, so
    // the badge stays out of the way.
    return { subscribe: () => () => undefined, getSnapshot: () => 'connected' };
  }
  return {
    subscribe: (listener) => connection.subscribe(listener),
    getSnapshot: () => connection.getState(),
  };
}

/** The connection state of `connection`, re-rendering when it changes. */
export function useConnectionState(connection: BoardConnection | null): ConnectionState {
  // Stable per connection, so React does not resubscribe on every render.
  const { subscribe, getSnapshot } = useMemo(() => storeFor(connection), [connection]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
