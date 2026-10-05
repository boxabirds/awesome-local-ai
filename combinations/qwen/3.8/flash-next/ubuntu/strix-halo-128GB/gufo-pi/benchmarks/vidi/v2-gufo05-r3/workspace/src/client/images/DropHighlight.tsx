/**
 * Drop highlight overlay: dashed outline shown while files are dragged over the board.
 */
export interface DropHighlightProps {
  visible: boolean;
}

export function DropHighlight({ visible }: DropHighlightProps) {
  if (!visible) return null;
  return (
    <div className="drop-highlight" data-drop-highlight="" aria-hidden="true" />
  );
}
