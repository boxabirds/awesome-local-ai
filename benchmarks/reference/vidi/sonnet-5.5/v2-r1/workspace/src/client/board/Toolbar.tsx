import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';
import type { useUndo } from './useUndo';

export function Toolbar(props: {
  onCreateSticky(): void;
  disabled?: boolean;
  undo?: ReturnType<typeof useUndo>;
  tool?: Tool;
  onTool?(tool: Tool): void;
}) {
  const tool = props.tool ?? 'select';
  return (
    <div
      className="left-toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        className={tool === 'select' ? 'tool-active' : undefined}
        onClick={() => props.onTool?.('select')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        className={tool === 'text' ? 'tool-active' : undefined}
        disabled={props.disabled}
        onClick={() => props.onTool?.('text')}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 6V4h14v2M12 4v16M9 20h6" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16v10l-6 6H4zM14 20v-6h6" />
        </svg>
      </button>
      {props.undo && <UndoButtons {...props.undo} />}
    </div>
  );
}
