// Drop highlight (story 12, image.drop): the board-wide overlay shown
// while image files are dragged over the board ("Drop images here").
// Rendered by BoardPage above the world layer; pointer-events are disabled
// so it never steals the drop.

import type { ReactElement } from 'react';

export interface DropHighlightProps {
  visible: boolean;
}

export function DropHighlight({ visible }: DropHighlightProps): ReactElement | null {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
      data-testid="drop-highlight"
    >
      <div className="absolute inset-2 rounded-lg border-2 border-dashed border-blue-500 bg-blue-500/10" />
      <div
        className="relative rounded-md bg-blue-600/90 px-4 py-2 text-sm font-medium text-white"
        role="status"
      >
        Drop images here
      </div>
    </div>
  );
}
