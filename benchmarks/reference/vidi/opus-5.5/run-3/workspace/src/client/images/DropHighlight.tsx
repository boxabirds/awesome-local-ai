/** Dashed outline over the board while files are dragged over it (image.drop). */
export function DropHighlight(props: { active: boolean }) {
  if (!props.active) return null;
  return <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" />;
}
