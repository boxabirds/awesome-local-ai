import type { JSX } from 'react';

// Story 12: dashed outline over the whole board while image files are dragged
// over it (image.drop). Non-interactive: the drop event keeps going to the
// viewport underneath.
export function DropHighlight(): JSX.Element {
  return (
    <div
      data-testid="drop-highlight"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 8,
        border: '2px dashed #1E88E5',
        borderRadius: 8,
        background: 'rgba(30, 136, 229, 0.06)',
        pointerEvents: 'none',
        zIndex: 46
      }}
    />
  );
}
