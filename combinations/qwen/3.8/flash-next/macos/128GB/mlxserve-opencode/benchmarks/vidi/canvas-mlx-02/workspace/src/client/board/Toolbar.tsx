// Left-side fixed toolbar (story 2) with the tool buttons (story 9: Select and
// Text; story 10: Shape and Connector; story 11: the Pen), the "Sticky note"
// creation button and,
// under it, this person's own Undo / Redo (story 8).
//
// The tools are shown as the board's own state, not as three separate actions:
// one is pressed at a time, all of them are creation doors and so all of them are
// inert on a board this client cannot edit. The Shape button carries one piece of
// extra state - which kind to draw next - because three shapes cannot share one
// drag gesture: pressing it opens the kind menu as well as choosing the tool, and
// picking a kind remembers it (shape.kind_menu) until the next pick.
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { UndoButtons, type UndoButtonsProps } from './UndoButtons.tsx';
import type { ToolId } from '../tools/useActiveTool.ts';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config.ts';

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
  tool?: ToolId;
  /** ask the board for a tool (a creation tool on a read-only board never arrives) */
  onTool?(tool: ToolId): void;
  /** the kind the Shape tool will draw next (story 10) */
  shapeKind?: ShapeKind;
  /** which kind to draw next; the Shape tool keeps it until the next pick */
  onShapeKind?(kind: ShapeKind): void;
  /**
   * The Image button (story 12): it opens the OS file picker and hands the board
   * back to Select - it is not a mode you stay in, so it never reads `tool`.
   */
  onImage?(): void;
}

// The three kinds, in the order the menu lists them, with the words a person
// reads. The order comes from the palette table, so a kind added there appears
// here without this file being touched.
const KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

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
  const { onCreateSticky, disabled = false, undo, tool, onTool, shapeKind = 'rect', onShapeKind, onImage } = props;
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const shapeRef = useRef<HTMLSpanElement | null>(null);

  // The menu belongs to the tool: opening the Shape tool - by the button or by S,
  // which is how the requirement's first step is walked - shows the three kinds
  // next to the button, and leaving the tool takes them away again.
  useEffect(() => {
    setKindMenuOpen(tool === 'shape');
  }, [tool]);

  // The menu is open only until it is answered: a click anywhere outside it closes
  // it, and Escape closes it too - and then travels on to give up the tool as well,
  // because the menu is only ever open while the Shape tool is, so one press is the
  // whole way back to Select.
  useEffect(() => {
    if (!kindMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (shapeRef.current && !shapeRef.current.contains(e.target as Node)) setKindMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setKindMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [kindMenuOpen]);

  const pickKind = (kind: ShapeKind) => {
    onShapeKind?.(kind);
    onTool?.('shape');
    setKindMenuOpen(false);
  };

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
      {/* The tools: exactly one is active; every one of them is a creation door,
          so every one of them obeys the board's single edit gate. */}
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
            data-testid="tool-shape-wrap"
            ref={shapeRef}
            style={{ position: 'relative', display: 'block' }}
          >
            <button
              type="button"
              aria-label="Shape (S)"
              title="Shape – S"
              data-testid="tool-shape"
              disabled={disabled}
              aria-disabled={disabled}
              aria-pressed={tool === 'shape'}
              aria-haspopup="menu"
              aria-expanded={kindMenuOpen}
              onClick={
                disabled
                  ? undefined
                  : () => {
                      onTool('shape');
                      setKindMenuOpen((open) => !open);
                    }
              }
              style={toolButtonStyle(tool === 'shape', disabled)}
            >
              {/* A square, a circle and a diamond: the three things this button
                  can draw, in the order the menu lists them. */}
              <span aria-hidden="true">◇</span>
            </button>
            {kindMenuOpen ? (
              <div
                role="menu"
                aria-label="Shape kind"
                data-testid="shape-kind-menu"
                style={{
                  position: 'absolute',
                  left: 'calc(100% + 8px)',
                  top: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  padding: 4,
                  background: '#ffffff',
                  border: '1px solid #e2e2e2',
                  borderRadius: 8,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                  whiteSpace: 'nowrap',
                  zIndex: 1,
                }}
              >
                {SHAPE_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitemradio"
                    aria-checked={kind === shapeKind}
                    aria-label={KIND_LABELS[kind]}
                    data-testid={`shape-kind-${kind}`}
                    onClick={() => pickKind(kind)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      border: 'none',
                      borderRadius: 6,
                      background: kind === shapeKind ? '#eef2ff' : 'transparent',
                      color: '#202020',
                      fontSize: 13,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
          <button
            type="button"
            aria-label="Connector (L)"
            title="Connector – L"
            data-testid="tool-connector"
            disabled={disabled}
            aria-disabled={disabled}
            aria-pressed={tool === 'connector'}
            onClick={disabled ? undefined : () => onTool('connector')}
            style={toolButtonStyle(tool === 'connector', disabled)}
          >
            <span aria-hidden="true">↗</span>
          </button>
          {/* The Pen (story 11) is the fifth tool, and it is what the letter 'p' has
              been routed to since story 9 - the keyboard's own tests have been asserting
              that letter for two stories, so nothing about the shortcut changes here. Like
              Shape and Connector it is a mode you stay in; unlike them it does not hand the
              board back to Select after one drawing, because a person holding a pen draws
              more than one line (pen.tool). Its two settings open next to the toolbar from
              BoardApp, not from here. */}
          <button
            type="button"
            aria-label="Pen (P)"
            title="Pen – P"
            data-testid="tool-pen"
            disabled={disabled}
            aria-disabled={disabled}
            aria-pressed={tool === 'pen'}
            onClick={disabled ? undefined : () => onTool('pen')}
            style={toolButtonStyle(tool === 'pen', disabled)}
          >
            <span aria-hidden="true">✎</span>
          </button>
          {/* The Image button (story 12) is not a mode: it opens the file picker and
              the board stays on Select, so unlike the tools around it it is never
              `aria-pressed` and never reads `tool`. It is a creation door, so it is
              inert on a board this client cannot edit. */}
          {onImage ? (
            <button
              type="button"
              aria-label="Image (I)"
              title="Image – I"
              data-testid="tool-image"
              disabled={disabled}
              aria-disabled={disabled}
              onClick={disabled ? undefined : onImage}
              style={toolButtonStyle(false, disabled)}
            >
              <span aria-hidden="true">🖼</span>
            </button>
          ) : null}
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
