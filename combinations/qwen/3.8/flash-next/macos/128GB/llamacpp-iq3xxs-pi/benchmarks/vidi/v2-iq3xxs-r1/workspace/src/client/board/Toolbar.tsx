import { useRef } from 'react';
import { useNativeStopPropagation } from './useNativeStopPropagation';

export interface ToolbarProps {
  /** Create a sticky note in the centre of the visible board area. */
  onCreateSticky(): void;
}

export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

/** Left-side vertical board toolbar. The Sticky note button is always available. */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNativeStopPropagation(ref);

  return (
    <div ref={ref} className="board-toolbar" data-testid="board-toolbar">
      <button
        type="button"
        className="tool-button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        onClick={onCreateSticky}
      >
        <span className="tool-icon" aria-hidden="true">
          {'\u{1F4CC}'}
        </span>
        Sticky note
      </button>
    </div>
  );
}
