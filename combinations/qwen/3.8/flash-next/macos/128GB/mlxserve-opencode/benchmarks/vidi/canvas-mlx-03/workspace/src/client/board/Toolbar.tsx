import { UndoButtons } from './UndoButtons.tsx';
import { useUndoBoundary, type UndoActions } from './useUndo.ts';
import type { Tool } from './useTool.ts';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited (story 4: it failed to load). */
  disabled?: boolean;
  /** True when the board accepts edits; the Select / Text tool buttons appear only then. */
  canEdit: boolean;
  /**
   * This tab's undo state (story 8): two booleans and two actions, from `useUndo`.
   * Omitted by a board that is not undoing anything.
   */
  undo?: UndoActions;
  /**
   * Story 9's tool mode: the active tool and its setter, for the Select and Text
   * buttons' pressed state. Omitting them hides the tool buttons entirely (an older
   * caller keeps just the sticky button + undo).
   */
  tool?: Tool;
  onSelectTool?(tool: Tool): void;
}

const buttonBase: React.CSSProperties = {
  width: 40,
  height: 40,
  border: 'none',
  borderRadius: 8,
  fontSize: 18,
  lineHeight: '40px',
};

/**
 * Fixed left-side vertical tool bar (stories 2, 8, 9): Select, Text and Sticky note,
 * then undo/redo. Select and Text are a *mode* (one is always pressed); the Sticky
 * button is an immediate action. Clicks stop propagation so they never reach the
 * viewport (which would clear the selection / start a pan).
 */
export function Toolbar(props: ToolbarProps) {
  const stop = (
    e: React.PointerEvent | React.MouseEvent | React.WheelEvent,
  ) => e.stopPropagation();
  // One click of a tool is one undo step, whatever the tool's own transaction does.
  const boundary = useUndoBoundary();
  const createSticky = () => {
    boundary();
    props.onCreateSticky();
    boundary();
  };
  // Select / Text tool buttons appear only on an editable board (a read-only
  // board has no Text tool). Sticky note / Undo / Redo always appear but disable.
  const hasTools = props.canEdit && props.onSelectTool != null;
  const disabled = !!props.disabled;
  const toolButton = (
    key: Tool,
    label: string,
    glyph: string,
    title: string,
    testId: string,
  ) => {
    const active = props.tool === key;
    return (
      <button
        type="button"
        aria-label={label}
        data-testid={testId}
        title={title}
        onClick={disabled ? undefined : () => props.onSelectTool?.(key)}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-pressed={hasTools ? active : undefined}
        style={{
          ...buttonBase,
          background: active ? '#cfe3ff' : '#eef1f5',
          color: '#1c3d69',
          fontWeight: 700,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <span aria-hidden>{glyph}</span>
      </button>
    );
  };
  return (
    <div
      data-testid="toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
      onWheel={stop}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: '#ffffff',
        border: '1px solid #d6d9de',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      {hasTools ? toolButton('select', 'Select', '⭢', 'Select – move and resize (V)', 'select-tool') : null}
      {hasTools ? toolButton('text', 'Text', 'T', 'Text – click the board to place a free text (T)', 'text-tool') : null}

      <button
        type="button"
        aria-label="Sticky note"
        data-testid="sticky-note-tool"
        title="Sticky note – or double-click the board"
        onClick={disabled ? undefined : createSticky}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        style={{
          ...buttonBase,
          background: '#FFF59D',
          color: '#5a4b00',
          fontSize: 20,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        {/* a small sticky-note glyph */}
        <span aria-hidden>&#128221;</span>
      </button>

      {/* Story 8: undo and redo, below the tools. They report this tab's history
          only, so on a shared board two people can be looking at different buttons. */}
      {props.undo ? (
        <UndoButtons
          canUndo={props.undo.canUndo}
          canRedo={props.undo.canRedo}
          onUndo={props.undo.undo}
          onRedo={props.undo.redo}
        />
      ) : null}
    </div>
  );
}
