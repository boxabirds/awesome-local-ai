// Dashed outline shown while files are dragged over the board.
// Story 12.

export function DropHighlight({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: '8px',
        border: '3px dashed #1976D2',
        borderRadius: '12px',
        backgroundColor: 'rgba(25, 118, 210, 0.05)',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
