/** Dashed outline over the board area while files are dragged over it. */
export function DropHighlight({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{ position: 'fixed', inset: 8, border: '3px dashed #1e88e5', borderRadius: 12, background: 'rgba(30,136,229,0.06)', pointerEvents: 'none', zIndex: 30 }}
    />
  );
}
