/**
 * Drop highlight: dashed outline shown over the board while files are dragged over it.
 */

export interface DropHighlightProps {
  visible: boolean;
}

export function DropHighlight({ visible }: DropHighlightProps) {
  if (!visible) return null;
  return (
    <div
      className="drop-highlight"
      data-testid="drop-highlight"
      style={{
        position: 'absolute',
        inset: 0,
        border: '3px dashed #1E88E5',
        borderRadius: 4,
        pointerEvents: 'none',
        zIndex: 100,
        backgroundColor: 'rgba(30, 136, 229, 0.05)',
      }}
    />
  );
}
