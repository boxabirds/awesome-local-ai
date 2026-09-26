import type { ReactElement, SyntheticEvent } from 'react';
import { UndoButtons } from './UndoButtons';
import type { Tool } from './useTool';

export interface ToolbarProps {
  /** Creates a sticky note at the centre of the visible board area. */
  onCreateSticky(): void;
  /** Story 4: disabled while the board failed to load (load_failed). */
  disabled?: boolean;
  /** Story 8: undo/redo state + handlers (rendered in the left toolbar). */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?(): void;
  onRedo?(): void;
  /** Story 9: the active tool (Select | Text) for aria-pressed state. */
  tool?: Tool;
  /** Story 9: switch the active tool (text.tool). */
  onSetTool?(tool: Tool): void;
}

/**
 * Fixed left-side toolbar (story 2). Holds the Sticky note button, the story
 * 9 Select/Text tool buttons, and the story 8 undo/redo buttons. Stops
 * pointer propagation so clicks never reach the viewport (which would pan or
 * clear the selection).
 *
 * Story 9 (text.tool): the Text button (T) is the ONLY way to create text;
 * the Sticky button (N / double-click) keeps the story 2 behaviour. The
 * buttons are a radio pair (aria-pressed); the Text tool is per-client and
 * never leaves this control (and the T shortcut).
 */
export function Toolbar(props: ToolbarProps): ReactElement {
  const stop = (e: SyntheticEvent) => {
    e.stopPropagation();
  };

  const tool = props.tool ?? 'select';
  const toolDisabled = props.disabled === true || props.onSetTool === undefined;

  const toolButtonStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    padding: 0,
    borderRadius: 8,
    border: '1px solid rgba(0, 0, 0, 0.15)',
    background: active ? 'rgba(26, 115, 232, 0.15)' : 'rgba(255, 255, 255, 0.9)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
  });

  return (
    <div
      data-testid="toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
      onPointerUp={stop}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        zIndex: 10,
      }}
    >
      {/* Story 9: tool pair (Select V / Text T). */}
      <button
        type="button"
        aria-label="Select (V)"
        aria-pressed={tool === 'select'}
        title="Select – V"
        data-testid="select-tool-button"
        disabled={toolDisabled}
        onClick={() => props.onSetTool?.('select')}
        style={toolButtonStyle(tool === 'select', toolDisabled)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 3l14 8-6 1.5L16 19l-3 1.5-3-6.5L5 18V3z"
            fill="rgba(255, 255, 255, 0.6)"
            stroke="rgba(0, 0, 0, 0.45)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        aria-pressed={tool === 'text'}
        title="Text – T"
        data-testid="text-tool-button"
        disabled={toolDisabled}
        onClick={() => props.onSetTool?.('text')}
        style={toolButtonStyle(tool === 'text', toolDisabled)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 5V3h14v2M12 3v18M9 21h6"
            stroke="rgba(0, 0, 0, 0.55)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        type="button"
        aria-label="Sticky note"
        title="Sticky note – or double-click the board"
        data-testid="sticky-button"
        disabled={props.disabled}
        onClick={props.onCreateSticky}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 40,
          height: 40,
          padding: 0,
          borderRadius: 8,
          border: '1px solid rgba(0, 0, 0, 0.15)',
          background: '#FFF59D',
          cursor: props.disabled ? 'default' : 'pointer',
          opacity: props.disabled ? 0.5 : 1,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 4h16v11l-5 5H4V4z" fill="rgba(255, 255, 255, 0.6)" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="1.5" />
          <path d="M15 20v-5h5" fill="rgba(255, 255, 255, 0.12)" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="1.5" />
        </svg>
      </button>

      {/* Story 8: undo / redo (this person's own steps only). */}
      {props.onUndo !== undefined && props.onRedo !== undefined && (
        <div style={{ height: 1, background: 'rgba(0, 0, 0, 0.12)', margin: '0 2px' }} aria-hidden="true" />
      )}
      {props.onUndo !== undefined && props.onRedo !== undefined && (
        <UndoButtons
          canUndo={props.canUndo ?? false}
          canRedo={props.canRedo ?? false}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
        />
      )}
    </div>
  );
}
