/**
 * Dashed outline overlay shown while files are dragged over the board.
 */
export function DropHighlight() {
  return (
    <div
      data-testid="drop-highlight"
      className="drop-highlight"
      aria-hidden="true"
    />
  );
}
