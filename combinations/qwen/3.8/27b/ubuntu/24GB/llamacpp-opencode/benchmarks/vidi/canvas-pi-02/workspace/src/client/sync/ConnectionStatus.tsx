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
 *   connected           -> hidden (a quiet board is a healthy one)
 *
 * Purely informational: it never locks the board out.
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
  }
  if (label === null) return null;

  return (
    <div className={`vidi6-badge ${tone}`.trim()} role="status">
      {label}
    </div>
  );
}
