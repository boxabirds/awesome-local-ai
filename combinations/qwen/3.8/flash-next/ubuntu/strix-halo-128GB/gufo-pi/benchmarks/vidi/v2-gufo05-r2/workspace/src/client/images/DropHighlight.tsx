/**
 * Story 12: dashed outline shown over the board area while files are dragged over it.
 */

export function DropHighlight({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="drop-highlight"
      data-testid="drop-highlight"
      aria-hidden="true"
    />
  );
}
