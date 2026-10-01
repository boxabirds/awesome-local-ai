/**
 * Dashed outline shown over the board while files are dragged over it.
 */
export function DropHighlight({ visible }: { visible: boolean }): React.ReactElement | null {
  if (!visible) return null;
  return (
    <div
      data-testid="drop-highlight"
      style={{
        position: 'fixed',
        inset: 0,
        border: '3px dashed #4285f4',
        borderRadius: 8,
        background: 'rgba(66, 133, 244, 0.08)',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  );
}
