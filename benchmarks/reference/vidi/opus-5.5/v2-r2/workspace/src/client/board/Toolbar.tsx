export const STICKY_BUTTON_TOOLTIP = 'Sticky note – or double-click the board';

/** Fixed left-side vertical toolbar. */
export function Toolbar(props: { onCreateSticky(): void }): React.JSX.Element {
  return (
    <div
      className="board-toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button type="button" aria-label="Sticky note" title={STICKY_BUTTON_TOOLTIP} onClick={props.onCreateSticky}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M4 4h16v10l-6 6H4V4Z" fill="#FFF59D" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M14 20v-6h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
