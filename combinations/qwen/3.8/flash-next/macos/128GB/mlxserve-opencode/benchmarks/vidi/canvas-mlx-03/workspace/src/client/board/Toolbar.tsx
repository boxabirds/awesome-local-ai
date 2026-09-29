import { UndoButtons } from './UndoButtons.tsx';
import { useUndoBoundary, type UndoActions } from './useUndo.ts';
import type { ToolId } from '../tools/useActiveTool.ts';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config.ts';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * Story 12: the Image button. It is an immediate action like the sticky note, not a mode —
   * it opens the file picker and leaves the board on Select, because a picture arrives from
   * the files this tab has rather than from a gesture on the board.
   */
  onAddImages?(): void;
  /** True while the board cannot be edited (story 4: it failed to load). */
  disabled?: boolean;
  /** True when the board accepts edits; the tool buttons appear only then. */
  canEdit: boolean;
  /**
   * This tab's undo state (story 8): two booleans and two actions, from `useUndo`.
   * Omitted by a board that is not undoing anything.
   */
  undo?: UndoActions;
  /**
   * The tool mode (stories 9, 10): the active tool and its setter, for the Select,
   * Text, Shape and Connector buttons' pressed state. Omitting them hides the tool
   * buttons entirely (an older caller keeps just the sticky button + undo).
   */
  tool?: ToolId;
  onSelectTool?(tool: ToolId): void;
  /**
   * Story 10: the kind the Shape tool will draw next. With it the Shape button grows
   * a small menu beside it (Rectangle / Ellipse / Diamond) while the tool is armed.
   */
  shapeKind?: ShapeKind;
  onSelectShapeKind?(kind: ShapeKind): void;
}

const buttonBase: React.CSSProperties = {
  width: 40,
  height: 40,
  border: 'none',
  borderRadius: 8,
  fontSize: 18,
  lineHeight: '40px',
};

/** What each of the three shape kinds is called in the Shape menu. */
const KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/** A small outline of the kind, so the menu is readable without a legend. */
const KIND_GLYPHS: Record<ShapeKind, string> = {
  rect: '▭',
  ellipse: '◯',
  diamond: '◇',
};

/**
 * Fixed left-side vertical tool bar (stories 2, 8, 9, 10): Select, Text, Shape,
 * Connector and Sticky note, then undo/redo. Select, Text, Shape and Connector are a
 * *mode* (one is always pressed); the Sticky button is an immediate action. Clicks
 * stop propagation so they never reach the viewport (which would clear the selection
 * / start a pan).
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
  // The tool buttons appear only on an editable board (a read-only board has no
  // creating tool). Sticky note / Undo / Redo always appear but disable.
  const hasTools = props.canEdit && props.onSelectTool != null;
  const disabled = !!props.disabled;
  const toolButton = (
    key: ToolId,
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
  // The Shape button and its kind menu: the menu is the small panel that opens next
  // to the button while the Shape tool is armed, and choosing a kind keeps the tool
  // armed (it picks the *next* shape's kind).
  const shapeMenu =
    hasTools && props.tool === 'shape' && props.onSelectShapeKind ? (
      <div
        data-testid="shape-kind-menu"
        role="menu"
        aria-label="Shape kind"
        onPointerDown={stop}
        onDoubleClick={stop}
        onWheel={stop}
        style={{
          position: 'absolute',
          left: '100%',
          top: 0,
          marginLeft: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          background: '#ffffff',
          border: '1px solid #d6d9de',
          borderRadius: 8,
          padding: 6,
          boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        }}
      >
        {SHAPE_KINDS.map((kind) => {
          const active = props.shapeKind === kind;
          return (
            <button
              key={kind}
              type="button"
              role="menuitem"
              aria-label={KIND_LABELS[kind]}
              data-testid={`shape-kind-${kind}`}
              title={KIND_LABELS[kind]}
              aria-pressed={active}
              onClick={() => props.onSelectShapeKind?.(kind)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 8px',
                border: active ? '2px solid #2f6fed' : '1px solid #d6d9de',
                borderRadius: 6,
                background: active ? '#eaf2ff' : '#ffffff',
                color: '#1c3d69',
                fontSize: 13,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span aria-hidden>{KIND_GLYPHS[kind]}</span>
              {KIND_LABELS[kind]}
            </button>
          );
        })}
      </div>
    ) : null;

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
      {hasTools ? (
        <div style={{ position: 'relative' }}>
          {toolButton('shape', 'Shape', '▢', 'Shape – drag or click the board (S)', 'shape-tool')}
          {shapeMenu}
        </div>
      ) : null}
      {hasTools ? toolButton('connector', 'Connector', '↗', 'Connector – drag from one object to another (L)', 'connector-tool') : null}
      {/* Story 11: the Pen. Like every tool button it is named `Pen` — accessible name,
          not hint text — so a stroke can be drawn by test, screen reader and mouse. */}
      {hasTools ? toolButton('pen', 'Pen', '✎', 'Pen – draw freehand (P)', 'pen-tool') : null}

      {/* Story 12: the Image button. An action, not a mode — it opens the picker and the board
          stays on Select — so it is never pressed, never armed, and never swallows a click. */}
      {props.onAddImages ? (
        <button
          type="button"
          aria-label="Image"
          data-testid="image-tool"
          title="Image – choose pictures to add, or drag them onto the board (I)"
          onClick={disabled ? undefined : props.onAddImages}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          style={{
            ...buttonBase,
            background: '#e8f0fe',
            color: '#1c3d69',
            fontSize: 18,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.45 : 1,
          }}
        >
          {/* a small picture glyph */}
          <span aria-hidden>&#128247;</span>
        </button>
      ) : null}

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
