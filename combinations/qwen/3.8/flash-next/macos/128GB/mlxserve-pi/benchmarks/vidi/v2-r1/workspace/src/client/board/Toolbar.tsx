import { type CSSProperties, type ReactNode } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/** The exact tooltip text (PRD: Sticky note button tooltip). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

const containerStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 6,
  borderRadius: 10,
  backgroundColor: 'rgba(255, 255, 255, 0.94)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.20)',
};

const noteIconStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 3,
  backgroundColor: '#FFF59D',
  boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.12)',
};

/**
 * The left tool rail. In this story it holds the "Sticky note" tool button; the
 * accessible name is the colour-agnostic "Sticky note" and the tooltip explains
 * the double-click shortcut. It stops pointer events so a click here never
 * reaches the board (which would clear the selection).
 */
export function Toolbar({ onCreateSticky }: ToolbarProps): ReactNode {
  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      style={containerStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title={STICKY_BUTTON_TOOLTIP}
        className="vidi6-icon-button"
        onClick={onCreateSticky}
      >
        <span style={noteIconStyle} aria-hidden="true" />
      </button>
    </div>
  );
}
