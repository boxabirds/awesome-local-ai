import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ShapeSnapshot } from '../../shared/board-model';
import { getShapeLabel } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import { TransformGesture } from '../board/transform-gesture';
import {
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_FONT_WORLD,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../../shared/config';
import { DRAG_THRESHOLD_PX } from '../../shared/config';

/** World units of label padding on each side: enough that a long word breaks
 * before it touches the drawn outline. */
const LABEL_PADDING = 8;

/** The accessible name of a kind, so a shape is announced as "Diamond" rather
 * than as an unlabelled group of SVG nodes. */
const KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export interface ShapeObjectProps {
  shape: ShapeSnapshot;
  doc: Y.Doc;
  /** True when this shape takes part in the selection. */
  selected: boolean;
  /** The group that moves with it: the whole selection, or just itself. */
  groupIds: readonly string[];
  /** The board's shared transform gesture (contract `sel.transform`). */
  gesture: TransformGesture;
  editing: boolean;
  /** False while the board could not be loaded: no drag, no label editing. */
  editable?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

type Mode = 'idle' | 'pressed' | 'dragging';

function alive(doc: Y.Doc, id: string): boolean {
  return doc.getMap<Y.Map<unknown>>('objects').has(id);
}

/** The drawn name of the shape's style, defaulting when a document carries an
 * unknown key (a hand-edited or future-version board). */
export function shapeColours(fill: string, stroke: string): { fill: string; stroke: string } {
  return {
    fill: Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, fill)
      ? SHAPE_FILL_COLORS[fill as FillColor]
      : 'transparent',
    stroke: Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, stroke)
      ? SHAPE_STROKE_COLORS[stroke as StrokeColor]
      : '#263238',
  };
}

/** The shape's outline path, inset by half the stroke so the drawn line stays
 * inside the object's box. A diamond is a closed polygon through the four side
 * midpoints, which is also where an arrow attaches. */
function shapeNode(kind: ShapeKind, width: number, height: number, inset: number, stroke: string, fill: string) {
  const w = Math.max(width - 2 * inset, 0);
  const h = Math.max(height - 2 * inset, 0);
  const common = { fill, stroke, strokeWidth: SHAPE_STROKE_WIDTH_WORLD } as const;
  if (kind === 'ellipse') {
    return <ellipse cx={width / 2} cy={height / 2} rx={w / 2} ry={h / 2} {...common} />;
  }
  if (kind === 'diamond') {
    const points = `${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`;
    return <polygon points={points} {...common} />;
  }
  return <rect x={inset} y={inset} width={w} height={h} {...common} />;
}

/**
 * A drawn shape: its SVG body plus the centred label.
 *
 * The label lives in a `foreignObject` sized to the shape, so wrapping and
 * centring are the browser's business: resize the shape and the label re-wraps
 * inside the new box without a single measurement in JS. Text is authored in
 * world units, so it scales with the board like a note's.
 *
 * Selection, moving and the shared resize handles come from the story 7 layer
 * (this object is registered as resizable and inside-box hittable); all the
 * interaction rendered here does is turn a press into a gesture and a
 * double-click into label editing.
 */
export function ShapeObject({
  shape,
  doc,
  selected,
  groupIds,
  gesture,
  editing,
  editable = true,
  onSelect,
  onStartEdit,
  onEndEdit,
}: ShapeObjectProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const modeRef = useRef<Mode>('idle');
  const start = useRef({ px: 0, py: 0, moved: false });
  const pressSelected = useRef(false);

  // A shape removed mid-interaction ends silently (contract `sel.transform`).
  useEffect(() => {
    if (!alive(doc, shape.id)) {
      modeRef.current = 'idle';
      setMode('idle');
    }
  }, [doc, shape.id]);

  const endDrag = useCallback(() => {
    if (modeRef.current !== 'idle') {
      modeRef.current = 'idle';
      setMode('idle');
    }
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // A Shift+press belongs to the board: it draws a marquee even when it
    // starts on a shape (contract `sel.marquee`).
    if (e.shiftKey) return;
    e.stopPropagation();
    if (editing || !editable) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, moved: false };
    modeRef.current = 'pressed';
    setMode('pressed');
    pressSelected.current = selected;
    const group = selected && groupIds.length > 1 ? [...groupIds] : [shape.id];
    gesture.beginMove(group, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (modeRef.current === 'idle') return;
    e.stopPropagation();
    if (!alive(doc, shape.id)) {
      gesture.reset();
      endDrag();
      return;
    }
    const dx = e.clientX - start.current.px;
    const dy = e.clientY - start.current.py;
    const dist = Math.hypot(dx, dy);
    if (dist < DRAG_THRESHOLD_PX) return;
    if (modeRef.current === 'pressed') {
      modeRef.current = 'dragging';
      setMode('dragging');
      if (!pressSelected.current) onSelect(shape.id);
    }
    gesture.update({ x: e.clientX, y: e.clientY }, dist);
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (modeRef.current === 'pressed') onSelect(shape.id);
    gesture.reset();
    endDrag();
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editing && editable) onStartEdit(shape.id);
  };

  const kind = (KIND_NAMES[shape.kind as ShapeKind] === undefined ? 'rect' : shape.kind) as ShapeKind;
  const { fill, stroke } = shapeColours(shape.fill, shape.stroke);
  const label = shape.label ?? '';
  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;
  const name = label.length > 0 ? `${KIND_NAMES[kind]}: ${label}` : KIND_NAMES[kind];

  return (
    <div
      role="group"
      aria-label={name}
      data-testid="shape"
      data-shape-id={shape.id}
      data-shape-kind={kind}
      data-selected={selected ? 'true' : 'false'}
      data-mode={mode}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: shape.width,
        height: shape.height,
        pointerEvents: 'auto',
        outline: selected ? '2px solid #2563eb' : 'none',
        outlineOffset: 0,
        overflow: 'hidden',
        color: '#111',
      }}
    >
      <svg
        data-testid="shape-body"
        width={shape.width}
        height={shape.height}
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {shapeNode(kind, shape.width, shape.height, SHAPE_STROKE_WIDTH_WORLD / 2, stroke, fill)}
        <foreignObject x={LABEL_PADDING} y={LABEL_PADDING} width={Math.max(shape.width - 2 * LABEL_PADDING, 0)} height={Math.max(shape.height - 2 * LABEL_PADDING, 0)}>
          {ytext !== undefined ? (
            <TextEditor
              key="edit"
              ytext={ytext}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              fontPx={SHAPE_LABEL_FONT_WORLD}
              lineHeight={1.25}
              padding={0}
              testId="shape-label-editor"
              ariaLabel="Shape label"
              onEnd={onEndEdit}
            />
          ) : (
            <div
              data-testid="shape-label"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflow: 'hidden',
                lineHeight: 1.25,
                fontSize: SHAPE_LABEL_FONT_WORLD,
              }}
            >
              {label}
            </div>
          )}
        </foreignObject>
      </svg>
    </div>
  );
}
