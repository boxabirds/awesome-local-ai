import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { ToolId as Tool } from '../tools/useActiveTool';
import type { ShapeKind } from '../../shared/config';
import { DEFAULT_SHAPE_KIND, SHAPE_KIND_NAMES, SHAPE_KINDS } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import { useUndo, useUndoController } from './useUndo';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * The tool the board is holding (story 9, extended by story 10): Select, Text, the
   * Shape tool or the Connector tool. Defaults to 'select' so a rail rendered on its
   * own (a story 2 / story 8 test) shows Select pressed.
   */
  tool?: Tool;
  /** Hold a tool from the rail (a Select / Text / Shape / Connector button click). */
  onSelectTool?(t: Tool): void;
  /**
   * Which kind the Shape tool will draw next (shape.menu). The Shape button's small
   * menu shows it pressed, which is how a person can see what a click means.
   */
  shapeKind?: ShapeKind;
  /** The Shape menu offered a different kind. */
  onShapeKind?(kind: ShapeKind): void;
  /**
   * True while the board could not be loaded: the Sticky note and Text buttons are
   * disabled so nothing can be created on a board that is not really there.
   */
  disabled?: boolean;
}

/** The fixed left-side tool rail. */
export function Toolbar({
  onCreateSticky,
  tool = 'select',
  onSelectTool,
  shapeKind = DEFAULT_SHAPE_KIND,
  onShapeKind,
  disabled = false,
}: ToolbarProps) {
  const stop = (e: ReactPointerEvent) => e.stopPropagation();
  const fire = () => {
    if (disabled) return;
    onCreateSticky();
  };
  const pick = (t: Tool) => {
    if (disabled && t !== 'select') return;
    onSelectTool?.(t);
  };
  const undo = useUndo(useUndoController(), !disabled);

  // A shared visual base for the two tool buttons; the active one is filled.
  const toolBtn = (active: boolean): CSSProperties => ({
    width: 40,
    height: 40,
    border: '1px solid #d0d3da',
    background: active ? '#dfe6ff' : '#fff',
    borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1,
    opacity: disabled ? 0.4 : 1,
  });

  // The Shape tool's kind menu, next to the button it belongs to (shape.menu).
  const kindMenu: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 4,
    border: '1px solid #d0d3da',
    borderRadius: 8,
    background: '#fff',
  };
  const kindBtn = (active: boolean): CSSProperties => ({
    border: 'none',
    background: active ? '#dfe6ff' : 'transparent',
    borderRadius: 6,
    padding: '4px 6px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'start',
  });

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
        aria-label="Select (V)"
        title="Select (V)"
        aria-pressed={tool === 'select'}
        data-testid="select-tool"
        onClick={() => pick('select')}
        style={toolBtn(tool === 'select')}
      >
        {'\u2196'}
      </button>
      <button
        type="button"
        aria-label="Text (T)"
        title="Text (T)"
        aria-pressed={tool === 'text'}
        data-testid="text-tool"
        disabled={disabled}
        onClick={() => pick('text')}
        style={toolBtn(tool === 'text')}
      >
        T
      </button>
      <button
        type="button"
        aria-label="Sticky note (N)"
        title="Sticky note (N) – or double-click the board"
        data-testid="create-sticky"
        disabled={disabled}
        onClick={fire}
        style={{
          width: 40,
          height: 40,
          border: '1px solid #d0d3da',
          background: '#FFF59D',
          borderRadius: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 18,
          lineHeight: 1,
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {'\u{1F4DD}'}
      </button>
      {/* The two story 10 tools. The Shape button carries a small menu, shown whenever
          the tool is held: what it says pressed is what a click on the board means. */}
      <button
        type="button"
        aria-label="Shape (S)"
        title={`Shape (S) \u2013 draws a ${SHAPE_KIND_NAMES[shapeKind].toLowerCase()}`}
        aria-pressed={tool === 'shape'}
        data-testid="shape-tool"
        aria-haspopup="menu"
        aria-expanded={tool === 'shape'}
        disabled={disabled}
        onClick={() => pick('shape')}
        style={toolBtn(tool === 'shape')}
      >
        {'\u25AD'}
      </button>
      {tool === 'shape' ? (
        <div
          role="menu"
          aria-label="Shape kind"
          data-testid="shape-kind-menu"
          className="shape-kind-menu"
          style={kindMenu}
        >
          {SHAPE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitemradio"
              aria-label={SHAPE_KIND_NAMES[kind]}
              title={`Draw a ${SHAPE_KIND_NAMES[kind].toLowerCase()}`}
              aria-checked={kind === shapeKind}
              data-testid={`shape-kind-${kind}`}
              onPointerDown={stop}
              onClick={() => onShapeKind?.(kind)}
              style={kindBtn(kind === shapeKind)}
            >
              {SHAPE_KIND_NAMES[kind]}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Connector (L)"
        title="Connector (L) \u2013 drag from one object to another"
        aria-pressed={tool === 'connector'}
        data-testid="connector-tool"
        disabled={disabled}
        onClick={() => pick('connector')}
        style={toolBtn(tool === 'connector')}
      >
        {'\u2197'}
      </button>
      <UndoButtons {...undo} />
    </div>
  );
}
