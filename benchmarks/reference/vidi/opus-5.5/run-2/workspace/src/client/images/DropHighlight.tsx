/** Dashed outline over the board while files are dragged over it (anchor: image.drop). */
export function DropHighlight(props: { visible: boolean }): React.JSX.Element | null {
  if (!props.visible) return null;
  return <div className="drop-highlight" data-testid="drop-highlight" aria-hidden="true" />;
}
