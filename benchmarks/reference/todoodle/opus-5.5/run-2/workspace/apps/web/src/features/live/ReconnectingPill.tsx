/** Live updates are paused but saving still works: a small pill, editing stays on. */
export function ReconnectingPill() {
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-40 rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground shadow-sm"
    >
      Reconnecting…
    </div>
  );
}
