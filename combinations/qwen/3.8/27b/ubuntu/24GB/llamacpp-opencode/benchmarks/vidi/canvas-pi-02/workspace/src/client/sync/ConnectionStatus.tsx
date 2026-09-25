import type { ConnectionState } from './connectBoard';

interface ConnectionStatusProps {
  /** Current connection phase; `null` means local-only mode (no badge). */
  phase: ConnectionState | null;
}

/**
 * Top-right connection badge (task 4 / task 7).
 *
 *   connecting          -> "Connecting…"   (subtle)
 *   reconnecting        -> "Reconnecting…" (warning tint)
 *   confirmedConnected  -> "Connected"     (green, only ≤ CONNECTED_CONFIRMATION_MS)
 *   load_failed         -> red error (persist.client_status)
 *   connected           -> hidden (a quiet board is a healthy one)
 *
 * The badge is informational; the edit lock it accompanies is App's
 * `canEdit` gate (false only for load_failed).
 */
export function ConnectionStatus({ phase }: ConnectionStatusProps) {
  if (phase === null) return null;

  let label: string | null = null;
  let tone = '';
  if (phase === 'connecting') {
    label = 'Connecting…';
  } else if (phase === 'reconnecting') {
    label = 'Reconnecting…';
    tone = 'vidi6-badge--warn';
  } else if (phase === 'confirmedConnected') {
    label = 'Connected';
    tone = 'vidi6-badge--ok';
  } else if (phase === 'load_failed') {
    label = 'This board couldn’t be loaded. Retrying…';
    tone = 'vidi6-badge--error';
  }
  if (label === null) return null;

  return (
    <div className={`vidi6-badge ${tone}`.trim()} role="status">
      {label}
    </div>
  );
}
