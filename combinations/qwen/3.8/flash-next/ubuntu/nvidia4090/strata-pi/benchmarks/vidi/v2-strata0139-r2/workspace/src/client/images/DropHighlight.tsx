/**
 * `image.drop` — the board saying "drop them here".
 *
 * A dashed outline over the whole board, shown while files are being dragged
 * over it and gone the moment they are dropped or leave. It is deliberately not
 * a target of its own: it has no pointer events, so the drop it advertises is
 * still the board's.
 */
export function DropHighlight({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" />;
}
