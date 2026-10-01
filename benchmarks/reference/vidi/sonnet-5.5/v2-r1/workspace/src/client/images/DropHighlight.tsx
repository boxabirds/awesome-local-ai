/** Dashed outline over the board while files are dragged over it. */
export function DropHighlight({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" />;
}
