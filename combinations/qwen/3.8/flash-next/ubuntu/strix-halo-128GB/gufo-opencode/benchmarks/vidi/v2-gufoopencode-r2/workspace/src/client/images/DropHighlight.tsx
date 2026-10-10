// Story 12: dashed outline over the board while files are dragged over it
// (image.drop). Presentational only; the viewport owns show/hide.

export function DropHighlight(): React.JSX.Element {
  return <div data-testid="drop-highlight" className="drop-highlight" aria-hidden="true" />;
}
