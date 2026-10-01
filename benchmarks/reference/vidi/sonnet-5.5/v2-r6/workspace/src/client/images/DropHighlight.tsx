/** Dashed outline around the board while files are dragged over it. */
export function DropHighlight({ active }: { active: boolean }) {
  return active ? <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" /> : null;
}
