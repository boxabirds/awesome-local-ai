import { useCallback } from 'react';

/**
 * The fixed left toolbar (anchor `sticky.toolbar`). Its only tool so far is the
 * sticky note button, which creates a note at the centre of the visible board.
 */
export interface ToolbarProps {
  onCreateSticky(): void;
}

export function Toolbar(props: ToolbarProps) {
  const { onCreateSticky } = props;

  const stop = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className="toolbar"
      data-testid="toolbar"
      data-board-chrome="true"
      role="toolbar"
      aria-label="Board tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      <button
        type="button"
        className="toolbar__button"
        data-testid="create-sticky"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        onClick={() => {
          onCreateSticky();
        }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="var(--sticky-icon, #FFF59D)" />
          <path d="M7 9h10M7 13h7" fill="none" stroke="#3d3d28" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="toolbar__label">Sticky note</span>
      </button>
    </div>
  );
}
