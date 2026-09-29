/**
 * Connection status badge (story 13, offline.status_ui).
 *
 * Shows the sync state of the board. Backward compatible with the
 * existing `phase` prop interface used by component tests.
 */

export type SyncState = 'synced' | 'pending_offline' | 'syncing';

interface ConnectionStatusProps {
  /** Existing connection phase (backward compat). */
  phase?: string;
  /** Story 13: online/offline state. */
  online?: boolean;
  /** Story 13: sync tracker state. */
  syncState?: SyncState;
}

export function ConnectionStatus({ phase, online, syncState }: ConnectionStatusProps) {
  // If we have the new-style props, use them.
  if (online !== undefined && syncState !== undefined) {
    if (online && syncState === 'synced') return null;

    let text: string;
    if (!online) {
      text = syncState === 'pending_offline'
        ? 'Offline — changes saved on this device'
        : 'Offline — changes saved';
    } else {
      text = 'Saving…';
    }

    const color = online ? 'var(--accent, #007AFF)' : 'var(--warning, #FF9500)';

    return (
      <div
        role="status"
        data-testid="connection-status"
        style={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '4px 12px',
          borderRadius: 12,
          backgroundColor: color,
          color: 'white',
          fontSize: 12,
          fontFamily: 'sans-serif',
          zIndex: 1000,
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
    );
  }

  // Backward compat: phase-based rendering (existing tests).
  if (phase === undefined) return null;

  let text: string | null = null;
  switch (phase) {
    case 'connecting':
      text = 'Connecting…';
      break;
    case 'reconnecting':
      text = 'Reconnecting…';
      break;
    case 'confirmedConnected':
      text = 'Connected';
      break;
    case 'load_failed':
      text = "This board couldn\u2019t be loaded. Retrying…";
      break;
    case 'connected':
    default:
      text = null;
      break;
  }

  if (text === null) return null;

  const isError = phase === 'load_failed';
  const color = isError ? 'var(--error, #FF3B30)' : 'var(--accent, #007AFF)';

  return (
    <div
      role="status"
      data-testid="connection-status"
      className={isError ? 'vidi6-badge--error' : undefined}
      style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 12px',
        borderRadius: 12,
        backgroundColor: color,
        color: 'white',
        fontSize: 12,
        fontFamily: 'sans-serif',
        zIndex: 1000,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  );
}
