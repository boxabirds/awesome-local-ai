/**
 * Dashed drop highlight shown while files are dragged over the board (story 12).
 */

import type { ReactNode } from 'react';

export interface DropHighlightProps {
  active: boolean;
  children: ReactNode;
}

/**
 * Wraps the board viewport. When `active` is true, a dashed outline appears
 * over the board area to indicate it accepts file drops.
 */
export function DropHighlight({ active, children }: DropHighlightProps): React.JSX.Element {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {children}
      {active && (
        <div
          data-testid="drop-highlight"
          style={{
            position: 'absolute',
            inset: 8,
            border: '3px dashed #4A90D9',
            borderRadius: 8,
            pointerEvents: 'none',
            zIndex: 9998,
          }}
        />
      )}
    </div>
  );
}
