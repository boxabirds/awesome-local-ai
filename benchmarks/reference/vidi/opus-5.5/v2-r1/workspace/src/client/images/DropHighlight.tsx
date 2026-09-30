/** Dashed outline over the board while files are dragged over it (story 12). */
export function DropHighlight(props: { visible: boolean }) {
  if (!props.visible) return null;
  return <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" />;
}
