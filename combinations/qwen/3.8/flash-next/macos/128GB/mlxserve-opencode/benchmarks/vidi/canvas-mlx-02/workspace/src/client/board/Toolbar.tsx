// Left-side fixed toolbar (story 2) with the tool buttons (story 9: Select and
// Text), the "Sticky note" creation button and, under it, this person's own
// Undo / Redo (story 8).
import type React from 'react';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons.tsx';
import type { Tool } from './useTool.ts';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * True only while the board cannot be edited at all (story 4: the room could
   * not load it). A disabled button is inert and says so to assistive tech.
   */
  disabled?: boolean;
  /**
   * This person's undo history, from `useUndo` on this tab's controller. Rendered
   * as Undo / Redo; each of them can only ever step back what this tab did.
   */
  undo?: UndoButtonsProps;
  /**
   * The active tool (story 9); absent until a board has tools, the same way
   * `undo` was absent before story 8. 'select' is the board's resting state.
   */
  tool?: Tool;
  /** ask the board for a tool (a 'text' request on a read-only board never arrives) */
  onTool?(tool: Tool): void;
}

// One tool button: square like the creation button, quiet until pressed.
function toolButtonStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: active ? '1px solid #2563eb' : '1px solid #e2e2e2',
    background: active ? '#eef2ff' : '#fafafa',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 16,
    fontWeight: active ? 700 : 400,
    color: '#202020',
    opacity: disabled ? 0.5 : 1,
  };
}

export function Toolbar(props: ToolbarProps): React.JSX.Element {
  const { onCreateSticky, disabled = false, undo, tool, onTool } = props;
  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 16,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: '#ffffff',
        border: '1px solid #e2e2e2',
        borderRadius: 12,
        boxShadow: '0 1px 6px rgba(0,0,0,0.1)',
        fontFamily: 'system-ui, sans-serif',
        zIndex: 10,
      }}
    >
      {/* The tools (story 9): exactly one is active; the Text tool is a
          creation door, so it obeys the board's single edit gate. */}
      {onTool ? (
        <>
          <button
            type="button"
            aria-label="Select (V)"
            title="Select – V"
            data-testid="tool-select"
            aria-pressed={tool === undefined || tool === 'select'}
            onClick={() => onTool('select')}
            style={toolButtonStyle(tool === undefined || tool === 'select', false)}
          >
            <span aria-hidden="true">↖</span>
          </button>
          <button
            type="button"
            aria-label="Text (T)"
            title="Text – T"
            data-testid="tool-text"
            disabled={disabled}
            aria-disabled={disabled}
            aria-pressed={tool === 'text'}
            onClick={disabled ? undefined : () => onTool('text')}
            style={toolButtonStyle(tool === 'text', disabled)}
          >
            <span aria-hidden="true">T</span>
          </button>
          <span
            aria-hidden="true"
            style={{ height: 1, margin: '2px 4px', background: '#e2e2e2' }}
          />
        </>
      ) : null}
      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="sticky-create"
        disabled={disabled}
        aria-disabled={disabled}
        onClick={disabled ? undefined : onCreateSticky}
        style={{
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid #e0c84a',
          background: '#FFF59D',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 20,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {/* Simple sticky-note glyph. */}
        <span aria-hidden="true">🗒</span>
      </button>

      {/* Undo / Redo of this person's own steps, kept apart from the creation
          button by a rule so they do not read as a third tool. */}
      {undo ? (
        <>
          <span
            aria-hidden="true"
            style={{ height: 1, margin: '2px 4px', background: '#e2e2e2' }}
          />
          <UndoButtons {...undo} />
        </>
      ) : null}
    </div>
  );
}
