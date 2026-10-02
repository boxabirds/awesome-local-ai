import type { PointerEvent as ReactPointerEvent } from 'react';

export interface ToolbarProps {
  onCreateSticky(): void;
}

/**
 * The fixed left-side tool rail. Story 2 adds the Sticky note button; later
 * stories add more tools here. Clicking it creates a note at the centre of the
 * visible board area and starts editing. Pointer events are stopped so a click
 * here never pans the board or clears the selection.
 */
export function Toolbar({ onCreateSticky }: ToolbarProps) {
  const stop = (e: ReactPointerEvent) => e.stopPropagation();
  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: '#fff',
        border: '1px solid #e2e4ea',
        borderRadius: 12,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="create-sticky"
        onClick={onCreateSticky}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #d0d3da',
          background: '#FFF59D',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        {'\u{1F4DD}'}
      </button>
    </div>
  );
}
