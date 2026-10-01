import { type JSX } from 'react';

/**
 * Dashed drop highlight shown while files are dragged over the board
 * (story 12, image.drop). Rendered by BoardUI while the drag counter > 0.
 */
export function DropHighlight(): JSX.Element {
  return (
    <div
      data-testid="drop-highlight"
      style={{
        position: 'fixed',
        inset: 8,
        border: '3px dashed #1E88E5',
        borderRadius: 12,
        backgroundColor: 'rgba(30, 136, 229, 0.08)',
        pointerEvents: 'none',
        zIndex: 1500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        color: '#1E88E5',
      }}
    >
      Drop images to add them
    </div>
  );
}
