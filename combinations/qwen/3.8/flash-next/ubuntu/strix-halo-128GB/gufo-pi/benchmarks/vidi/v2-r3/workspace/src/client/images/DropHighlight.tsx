/**
 * DropHighlight: dashed outline over the board area while files are dragged over it (story 12).
 */
import React from 'react';

export interface DropHighlightProps {
  visible: boolean;
}

export function DropHighlight({ visible }: DropHighlightProps) {
  if (!visible) return null;
  return (
    <div
      data-testid="drop-highlight"
      style={{
        position: 'absolute',
        inset: 8,
        border: '3px dashed #1976D2',
        borderRadius: 12,
        backgroundColor: 'rgba(25, 118, 210, 0.05)',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    />
  );
}
