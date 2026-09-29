// The drag-over outline (story 12, design `image.insert` / images.drop). A quiet
// dashed frame around the whole board that appears while a person is dragging
// FILES over it and disappears the moment the drag leaves or drops - the board's
// way of saying "this is where images land". It is deliberately `pointer-events:
// none` so it never intercepts the drop it is describing, and it draws nothing when
// the drag is not carrying files (dragging a note around shows no such frame).
import type React from 'react';

export interface DropHighlightProps {
  active: boolean;
}

export function DropHighlight({ active }: DropHighlightProps): React.JSX.Element | null {
  if (!active) return null;
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 8,
        border: '2px dashed #2563eb',
        borderRadius: 12,
        background: 'rgba(37, 99, 235, 0.06)',
        pointerEvents: 'none',
        zIndex: 30,
        boxSizing: 'border-box',
      }}
    />
  );
}
