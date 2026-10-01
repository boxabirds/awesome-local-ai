/**
 * Dashed drop highlight overlay shown while files are dragged over the board.
 */
export function DropHighlight(): React.JSX.Element {
  return (
    <div
      className="drop-highlight"
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        border: '3px dashed #1E88E5',
        borderRadius: 8,
        backgroundColor: 'rgba(30, 136, 229, 0.05)',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  );
}
