import type { JSX } from 'react';
/**
 * Left-side vertical toolbar with the Sticky note button.
 */
export function Toolbar(props: { onCreateSticky(): void; disabled?: boolean }): JSX.Element {
  return (
    <div className="toolbar" data-testid="toolbar">
      <button
        type="button"
        className="toolbar-button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        disabled={props.disabled === true}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={props.onCreateSticky}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2" y="2" width="16" height="16" rx="2" fill="#FFF59D" stroke="#c8cdd4" strokeWidth="1" />
          <line x1="5" y1="7" x2="15" y2="7" stroke="#8a8a5c" strokeWidth="1.5" />
          <line x1="5" y1="11" x2="12" y2="11" stroke="#8a8a5c" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  );
}
