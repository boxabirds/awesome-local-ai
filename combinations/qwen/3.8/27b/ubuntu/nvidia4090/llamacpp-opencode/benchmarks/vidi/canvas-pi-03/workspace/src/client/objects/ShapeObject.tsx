import { useMemo, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '@/shared/config';
import { getShapeLabel, type FillColor, type ShapeKind, type StrokeColor } from '@/shared/objects/shape';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

/**
 * A shape object (story 10, shape.render): the kind's outline (rect,
 * ellipse or diamond) in world units — so the line width scales with zoom
 * (shape.style) — with a centred, wrapping label at SHAPE_LABEL_FONT_PX.
 *
 * Double-click (or Enter, via the board keys) enters inline editing: the
 * label Y.Text is edited with the shared TextEditor clamped to
 * SHAPE_LABEL_MAX_CHARS (shape.label_limit). The editor is the shape's box
 * (fill mode) with centred text.
 */

export interface ShapeObjectProps extends ObjectProps {
  /** The shape's live box + style arrive via the snapshot spread (ObjectProps). */
  doc?: Y.Doc;
  zoom?: number;
  selected?: boolean;
  editing?: boolean;
  editable?: boolean;
  onStartEdit?: (id: string) => void;
  onEndEdit?: (next: 'selected' | 'unselected') => void;
  onTextBoundary?: () => void;
  onTextUndo?: () => void;
  onTextRedo?: () => void;
}

const LABEL_COLOR = '#1F2937';

/**
 * The kind's outline as an SVG element in the shape's local (0,0,w,h)
 * coordinate space. Exported so the Shape tool's preview draws the exact
 * same geometry as the committed object.
 */
export function shapeElement(
  kind: ShapeKind,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  dashed = false,
): ReactElement | null {
  const common = {
    fill,
    stroke,
    strokeWidth,
    ...(dashed ? { strokeDasharray: '6 4' } : {}),
  };
  const sw2 = strokeWidth / 2;
  switch (kind) {
    case 'rect':
      return (
        <rect x={sw2} y={sw2} width={Math.max(w - strokeWidth, 0)} height={Math.max(h - strokeWidth, 0)} {...common} />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(w / 2 - sw2, 0)}
          ry={Math.max(h / 2 - sw2, 0)}
          {...common}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${w / 2},${sw2} ${w - sw2},${h / 2} ${w / 2},${h - sw2} ${sw2},${h / 2}`}
          {...common}
        />
      );
  }
  return null;
}

function isKnownKind(v: unknown): v is ShapeKind {
  return v === 'rect' || v === 'ellipse' || v === 'diamond';
}

export function ShapeObject(props: ShapeObjectProps): ReactElement {
  const kind: ShapeKind = isKnownKind(props.kind) ? props.kind : 'rect';
  const width = typeof props.width === 'number' ? props.width : SHAPE_DEFAULT_SIZE_WORLD;
  const height = typeof props.height === 'number' ? props.height : SHAPE_DEFAULT_SIZE_WORLD;
  const fillName: FillColor =
    typeof props.fill === 'string' && props.fill in SHAPE_FILL_COLORS ? (props.fill as FillColor) : 'white';
  const strokeName: StrokeColor =
    typeof props.stroke === 'string' && props.stroke in SHAPE_STROKE_COLORS ? (props.stroke as StrokeColor) : 'dark';
  const label = typeof props.label === 'string' ? props.label : '';
  const selected = props.selected === true;
  const editing = props.editing === true;
  const editable = props.editable !== false;
  const doc = props.doc as Y.Doc | undefined;

  // Story 8: adapt the board's undo callbacks to the editor's controller
  // (same pattern as StickyNote / TextObject).
  const undoCallbacks = useMemo(() => {
    const boundaryRef = { current: props.onTextBoundary as (() => void) | undefined };
    const undoRef = { current: props.onTextUndo as (() => void) | undefined };
    const redoRef = { current: props.onTextRedo as (() => void) | undefined };
    const controller: UndoController = {
      undo: () => {
        undoRef.current?.();
        return true;
      },
      redo: () => {
        redoRef.current?.();
        return true;
      },
      boundary: () => {
        boundaryRef.current?.();
      },
      canUndo: () => true,
      canRedo: () => true,
      addScope: () => {},
      onChange: () => () => {},
      destroy: () => {},
    };
    return { controller, boundaryRef, undoRef, redoRef };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  undoCallbacks.boundaryRef.current = props.onTextBoundary;
  undoCallbacks.undoRef.current = props.onTextUndo;
  undoCallbacks.redoRef.current = props.onTextRedo;

  const ytext = doc !== undefined ? getShapeLabel(doc, props.id) : undefined;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // The board must not pan when a press starts on a shape; the gesture
    // stops propagation and drives select/toggle/move from here.
    props.onObjectPointerDown?.(e);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    // The viewport must not act on a double-click of a shape.
    e.stopPropagation();
    if (!editing && editable) props.onStartEdit?.(props.id);
  };

  return (
    <div
      data-testid="shape"
      data-id={props.id}
      data-kind={kind}
      data-selected={selected ? true : undefined}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: `translate(${props.x}px, ${props.y}px)`,
        width,
        height,
        cursor: 'move',
        boxSizing: 'border-box',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', left: 0, top: 0, display: 'block', overflow: 'visible' }}
      >
        {shapeElement(kind, width, height, SHAPE_FILL_COLORS[fillName], SHAPE_STROKE_COLORS[strokeName], SHAPE_STROKE_WIDTH_WORLD)}
        {label !== '' && !editing && (
          <foreignObject x={0} y={0} width={width} height={height} style={{ pointerEvents: 'none' }}>
            <div
              data-testid="shape-label"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 6,
                boxSizing: 'border-box',
              }}
            >
              <span
                style={{
                  fontSize: SHAPE_LABEL_FONT_PX,
                  color: LABEL_COLOR,
                  textAlign: 'center',
                  lineHeight: 1.25,
                  wordBreak: 'break-word',
                  whiteSpace: 'normal',
                }}
              >
                {label}
              </span>
            </div>
          </foreignObject>
        )}
      </svg>
      {selected && (
        <div
          data-testid="shape-selection"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -3,
            top: -3,
            right: -3,
            bottom: -3,
            border: '2px solid #1A73E8',
            pointerEvents: 'none',
          }}
        />
      )}
      {editing && ytext !== undefined && (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={SHAPE_LABEL_FONT_PX}
          width={width}
          onEnd={(next: 'selected' | 'unselected') => props.onEndEdit?.(next)}
          undo={undoCallbacks.controller}
          align="center"
          testId="shape-label-editor"
          textareaTestId="shape-label-textarea"
        />
      )}
    </div>
  );
}
