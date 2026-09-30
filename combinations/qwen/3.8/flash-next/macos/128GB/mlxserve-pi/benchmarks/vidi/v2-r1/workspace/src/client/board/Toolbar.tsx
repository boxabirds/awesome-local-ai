import { type CSSProperties, type ReactNode } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import { UndoButtons } from './UndoButtons';
import type { UseUndoResult } from './useUndo';
import type { Tool } from './useTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /**
   * Which tool is up now (`text.tool_ui`). The rail shows it: a tool you cannot see
   * is a tool you think did nothing. Story 9 added this; before it the rail had one
   * button that was not a mode at all.
   */
  tool?: Tool;
  /** Pick a tool. `select` puts the board back the way it was. */
  onTool?(tool: Tool): void;
  /**
   * Which shape the Shape tool draws next (`shape.kind_menu`). It is remembered after
   * a shape is drawn rather than reset to the first kind, because drawing five ellipses
   * means clicking the rail five times otherwise.
   */
  shapeKind?: ShapeKind;
  /** Which shape the Shape tool draws next. */
  onShapeKind?(kind: ShapeKind): void;
  /**
   * The board cannot be changed right now, so the tool that changes it is off.
   * `disabled` rather than hidden: the rail stays where people learned it is, and
   * the reason is in the badge above it.
   */
  disabled?: boolean;
  /** This tab's undo / redo state (story 8); absent means the rail has no undo pair. */
  undo?: UseUndoResult;
}

/** The exact tooltip text (PRD: Sticky note button tooltip). */
export const STICKY_BUTTON_TOOLTIP = 'Sticky note \u2013 or double-click the board';

const containerStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 6,
  borderRadius: 10,
  backgroundColor: 'rgba(255, 255, 255, 0.94)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.20)',
};

const noteIconStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 3,
  backgroundColor: '#FFF59D',
  boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.12)',
};

/** What each kind of shape is called, in the kind menu and to a screen reader. */
export const SHAPE_KIND_LABEL: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/** The kind menu's marks. */
export const SHAPE_KIND_GLYPH: Record<ShapeKind, string> = {
  rect: '\u25A1',
  ellipse: '\u25CB',
  diamond: '\u25C7',
};

/** A tool that is up looks pressed; a tool that is not does not. */
const toolButtonStyle = (active: boolean): CSSProperties => ({
  borderColor: active ? '#1f2328' : '#d6dae0',
  backgroundColor: active ? '#eef2f7' : '#ffffff',
});

const glyphStyle: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.2,
};

/**
 * The left tool rail. In this story it holds the "Sticky note" tool button; the
 * accessible name is the colour-agnostic "Sticky note" and the tooltip explains
 * the double-click shortcut. It stops pointer events so a click here never
 * reaches the board (which would clear the selection).
 */
export function Toolbar({
  onCreateSticky,
  tool = 'select',
  onTool,
  shapeKind = 'rect',
  onShapeKind,
  disabled = false,
  undo,
}: ToolbarProps): ReactNode {
  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
      style={containerStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-testid="tool-select"
        aria-label="Select (V)"
        title="Select (V) \u2013 click, drag and move things"
        className="vidi6-icon-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool === 'select'}
        style={toolButtonStyle(tool === 'select')}
        onClick={() => {
          onTool?.('select');
        }}
      >
        <span style={glyphStyle} aria-hidden="true">
          &#8598;
        </span>
      </button>
      <button
        type="button"
        data-testid="tool-text"
        aria-label="Text (T)"
        title="Text (T) \u2013 click the board and type"
        className="vidi6-icon-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool === 'text'}
        style={toolButtonStyle(tool === 'text')}
        onClick={() => {
          onTool?.('text');
        }}
      >
        <span style={glyphStyle} aria-hidden="true">
          T
        </span>
      </button>
      <button
        type="button"
        data-testid="tool-shape"
        aria-label="Shape (S)"
        title="Shape (S) \u2013 drag to draw a shape, click to drop one"
        className="vidi6-icon-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool === 'shape'}
        style={toolButtonStyle(tool === 'shape')}
        onClick={() => {
          onTool?.('shape');
        }}
      >
        <span style={glyphStyle} aria-hidden="true">
          &#9671;
        </span>
      </button>
      {/* The kind the Shape tool draws, shown while it is the tool that is up: three
          buttons rather than one that cycles, because a shape you meant to be an
          ellipse should not have to be drawn twice to find out. */}
      {tool === 'shape'
        ? SHAPE_KINDS.map((kind: ShapeKind) => (
            <button
              key={kind}
              type="button"
              data-testid={`shape-kind-${kind}`}
              aria-label={SHAPE_KIND_LABEL[kind] ?? kind}
              title={`${SHAPE_KIND_LABEL[kind] ?? kind} \u2013 what S draws next`}
              className="vidi6-icon-button"
              disabled={disabled}
              aria-disabled={disabled}
              aria-pressed={kind === shapeKind}
              style={{ ...toolButtonStyle(kind === shapeKind), marginLeft: 22 }}
              onClick={() => {
                onShapeKind?.(kind);
              }}
            >
              <span style={glyphStyle} aria-hidden="true">
                {SHAPE_KIND_GLYPH[kind] ?? kind}
              </span>
            </button>
          ))
        : null}
      <button
        type="button"
        data-testid="tool-connector"
        aria-label="Connector (L)"
        title="Connector (L) \u2013 drag from one thing to another"
        className="vidi6-icon-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool === 'connector'}
        style={toolButtonStyle(tool === 'connector')}
        onClick={() => {
          onTool?.('connector');
        }}
      >
        <span style={glyphStyle} aria-hidden="true">
          {"\u2194"}
        </span>
      </button>
      <button
        type="button"
        data-testid="tool-pen"
        aria-label="Pen (P)"
        title="Pen (P) \u2013 draw freehand; Escape puts the pen away"
        className="vidi6-icon-button"
        disabled={disabled}
        aria-disabled={disabled}
        aria-pressed={tool === 'pen'}
        style={toolButtonStyle(tool === 'pen')}
        onClick={() => {
          onTool?.('pen');
        }}
      >
        <span style={glyphStyle} aria-hidden="true">
          {"\u270E"}
        </span>
      </button>
      {/* Adding an image is the rail's one-shot action, not a mode: it opens the file
          picker and the board is back on Select (`image.pick`). A board you cannot edit
          gets neither the picker nor a pressed button (`image.offline`). */}
      <button
        type="button"
        data-testid="tool-image"
        aria-label="Image (I)"
        title="Image (I) \u2013 add a PNG, JPEG, GIF or WebP"
        className="vidi6-icon-button"
        disabled={disabled}
        aria-disabled={disabled}
        onClick={() => {
          onTool?.('image');
        }}
      >
        <span style={glyphStyle} aria-hidden="true">
          {"\uD83D\uDBBC"}
        </span>
      </button>
      <button
        type="button"
        data-testid="create-sticky"
        // Story 9 labels the rail by shortcut: this one is N. The tooltip stays what
        // story 2 wrote, because the double-click it promises is still the point.
        aria-label="Sticky note (N)"
        title={STICKY_BUTTON_TOOLTIP}
        className="vidi6-icon-button"
        disabled={disabled}
        aria-disabled={disabled}
        onClick={onCreateSticky}
      >
        <span style={noteIconStyle} aria-hidden="true" />
      </button>
      {undo ? (
        <UndoButtons
          canUndo={undo.canUndo && !disabled}
          canRedo={undo.canRedo && !disabled}
          onUndo={undo.undo}
          onRedo={undo.redo}
        />
      ) : null}
    </div>
  );
}
