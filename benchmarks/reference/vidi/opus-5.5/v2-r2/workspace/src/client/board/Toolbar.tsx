import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import type { useUndo } from './useUndo';

export const STICKY_BUTTON_TOOLTIP = 'Sticky note (N) – or double-click the board';

/** Fixed left-side vertical toolbar: Select and Text tools, Sticky note, then Undo and Redo. */
export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: ReturnType<typeof useUndo>;
  /** The active tool (highlighted); omitted → Select. */
  tool?: Tool;
  onTool?(t: Tool): void;
}): React.JSX.Element {
  const tool = props.tool ?? 'select';
  return (
    <div
      className="board-toolbar"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        onClick={() => props.onTool?.('select')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M6 3l12 9.5-5.5 1 3.2 6.3-2.4 1.2-3.2-6.4L6 18.5V3Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        disabled={props.disabled}
        onClick={() => props.onTool?.('text')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M5 5h14v3h-2V7h-4v11h2v2H9v-2h2V7H7v1H5V5Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M4 4h16v10l-6 6H4V4Z" fill="#FFF59D" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M14 20v-6h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      {props.undo && (
        <>
          <span className="board-toolbar-divider" aria-hidden="true" />
          <UndoButtons {...props.undo} />
        </>
      )}
    </div>
  );
}
