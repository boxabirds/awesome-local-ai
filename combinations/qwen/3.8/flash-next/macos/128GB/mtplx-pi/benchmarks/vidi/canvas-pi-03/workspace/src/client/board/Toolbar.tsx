import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import type { ToolId } from '../tools/useActiveTool';

export interface ToolbarProps {
  onCreateSticky(): void;
  /** True while the board cannot be edited (load failure): the creation button
   * is rendered disabled, so the failure is visible instead of silent. */
  disabled?: boolean;
  /** The board's active tool. Omit for a palette with no tools. */
  tool?: ToolId;
  /** Which shape the Shape button draws. */
  shapeKind?: ShapeKind;
  /** Choose a tool from the palette. */
  onSelectTool?(tool: ToolId): void;
  /** Choose what the Shape tool draws next. */
  onSelectShapeKind?(kind: ShapeKind): void;
}

/** The Shape tool's kinds, in the order the menu lists them. */
const KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

const buttonStyle = (active: boolean, disabled: boolean, background = '#ffffff') => ({
  width: 40,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: disabled ? 'not-allowed' : 'pointer',
  border: active ? '1px solid #2563eb' : '1px solid rgba(0,0,0,0.25)',
  borderRadius: 8,
  background: active ? '#DBEAFE' : background,
  fontSize: 16,
  color: '#111',
  opacity: disabled ? 0.4 : 1,
});

/**
 * The fixed left-side tool palette: the pointer tools, the creation tools and
 * the sticky-note button. It stops pointer propagation so a click in the palette
 * never reaches the board (which would otherwise clear the selection or pan).
 *
 * Tools are `aria-pressed` toggles, not radio buttons: arming one creates
 * nothing, it changes what the next click on the board means. While the Shape
 * tool is armed it grows a kind menu (Rectangle / Ellipse / Diamond), because
 * the Shape button is one tool with three drawing modes, not three tools.
 */
export function Toolbar({
  onCreateSticky,
  disabled = false,
  tool = 'select',
  shapeKind = 'rect',
  onSelectTool,
  onSelectShapeKind,
}: ToolbarProps) {
  const toolButton = (value: ToolId, label: string, title: string, glyph: string) => {
    const active = tool === value;
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled}
        disabled={disabled}
        data-disabled={disabled ? 'true' : 'false'}
        title={title}
        data-testid={`tool-${value}`}
        onClick={() => onSelectTool?.(value)}
        style={buttonStyle(active, disabled)}
      >
        {glyph}
      </button>
    );
  };

  return (
    <div
      data-testid="toolbar"
      role="toolbar"
      aria-label="Tools"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 6,
        background: '#ffffff',
        border: '1px solid rgba(17,17,17,0.12)',
        borderRadius: 10,
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
    >
      {toolButton('select', 'Select (V)', 'Select – or press Escape', '\u2191')}
      {toolButton('text', 'Text (T)', 'Text – or press T', 'T')}
      <div style={{ position: 'relative' }}>
        {toolButton('shape', 'Shape (S)', 'Shape – or press S', '\u25A1')}
        {tool === 'shape' && (
          <div
            data-testid="shape-kind-menu"
            role="group"
            aria-label="Shape kind"
            style={{
              position: 'absolute',
              left: 'calc(100% + 6px)',
              top: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: 6,
              background: '#ffffff',
              border: '1px solid rgba(17,17,17,0.12)',
              borderRadius: 8,
              boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
            }}
          >
            {SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-label={KIND_LABELS[kind]}
                aria-pressed={kind === shapeKind}
                data-testid={`shape-kind-${kind}`}
                onClick={() => onSelectShapeKind?.(kind)}
                style={{
                  ...buttonStyle(kind === shapeKind, false),
                  width: 120,
                  justifyContent: 'flex-start',
                  padding: '0 8px',
                  fontSize: 13,
                }}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        )}
      </div>
      {toolButton('connector', 'Connector (L)', 'Connector – or press L', '\u2192')}
      <button
        type="button"
        aria-label="Sticky note"
        aria-disabled={disabled}
        disabled={disabled}
        data-disabled={disabled ? 'true' : 'false'}
        title="Sticky note – or double-click the board"
        data-testid="create-sticky"
        onClick={() => onCreateSticky()}
        style={{ ...buttonStyle(false, disabled, '#FFF59D'), fontSize: 20 }}
      >
        &#9634;
      </button>
    </div>
  );
}
