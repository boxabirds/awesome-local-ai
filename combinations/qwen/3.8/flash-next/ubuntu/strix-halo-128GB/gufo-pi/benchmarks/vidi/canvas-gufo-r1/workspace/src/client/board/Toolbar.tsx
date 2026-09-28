export interface ToolbarProps {
  onCreateSticky(): void;
  disabled?: boolean;
}

/**
 * Fixed left-side toolbar with the Sticky note creation button.
 */
export function Toolbar(props: ToolbarProps) {
  const { onCreateSticky, disabled } = props;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="toolbar-left"
      data-testid="toolbar-left"
      onPointerDown={handlePointerDown}
    >
      <button
        type="button"
        aria-label="Sticky note"
        title={`Sticky note \u2013 or double-click the board`}
        className="toolbar-btn"
        data-testid="create-sticky-btn"
        onClick={onCreateSticky}
        disabled={disabled}
      >
        <span className="toolbar-btn-icon" aria-hidden="true">
          {'\u25A1'}
        </span>
        <span className="toolbar-btn-label">Sticky note</span>
      </button>
    </div>
  );
}
