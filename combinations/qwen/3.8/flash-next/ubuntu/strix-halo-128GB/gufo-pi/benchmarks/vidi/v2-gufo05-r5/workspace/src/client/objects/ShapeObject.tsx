/**
 * A shape on the board (story 10): an SVG outline, a label centred in it, and the swatch bar that
 * paints it.
 *
 * The outline is drawn in world units inside the world layer, so it scales with the board exactly
 * as a note does and needs no per-frame measurement. The label is HTML laid over it: centred in
 * both directions, wrapping with CSS, so it re-wraps by itself when the shape is resized or when
 * somebody else resizes it. Interaction is the generic story 7 gesture, exactly like a note.
 */
import { memo, useMemo, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  deleteObject,
  getShapeLabel,
  setShapeStyle,
  type ShapeSnapshot,
} from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_SIZE_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';
import type { ObjectProps } from './ObjectProps';
import { ShapeToolbar } from './ShapeToolbar';
import { TextEditor } from './TextEditor';

export interface ShapeObjectProps extends ObjectProps {
  note: ShapeSnapshot;
}

/** The outline, inset by half the stroke so the line stays inside the shape's box. */
function outline(kind: ShapeSnapshot['kind'], w: number, h: number, t: number): JSX.Element {
  if (kind === 'ellipse') {
    return (
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={Math.max(0, (w - t) / 2)}
        ry={Math.max(0, (h - t) / 2)}
      />
    );
  }
  if (kind === 'diamond') {
    const inset = t / 2;
    return (
      <polygon
        points={`${w / 2},${inset} ${w - inset},${h / 2} ${w / 2},${h - inset} ${inset},${h / 2}`}
      />
    );
  }
  return <rect x={t / 2} y={t / 2} width={Math.max(0, w - t)} height={Math.max(0, h - t)} />;
}

function ShapeObjectBase({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging,
  canEdit = true,
  onSelect,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undo,
}: ShapeObjectProps): JSX.Element {
  const label = useMemo(() => getShapeLabel(doc, note.id), [doc, note.id]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // the swatch bar answers its own clicks
    if (target?.closest('[data-shape-toolbar]')) return;
    event.stopPropagation();
    if (editing) return; // typing belongs to the editor
    onObjectPointerDown(event, note.id);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // the board must not put another shape under this one
    event.stopPropagation();
    event.preventDefault();
    if (editing) return;
    onSelect(note.id);
    if (!canEdit) return;
    onStartEdit(note.id);
  };

  const style = {
    left: note.x,
    top: note.y,
    width: note.width,
    height: note.height,
    zIndex: note.z,
    // the swatch bar is counter-scaled, so it stays the same size on screen at any zoom
    '--shape-inverse-zoom': zoom > 0 ? String(1 / zoom) : '1',
  } as CSSProperties;

  return (
    <div
      className="shape-object"
      data-board-object
      data-shape-object
      data-shape-id={note.id}
      data-kind={note.kind}
      data-selected={selected ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-testid="shape-object"
      role="group"
      aria-label={`${note.kind} shape`}
      tabIndex={0}
      style={style}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        className="shape-object__svg"
        width={note.width}
        height={note.height}
        viewBox={`0 0 ${note.width} ${note.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <g
          fill={SHAPE_FILL_COLORS[note.fill]}
          stroke={SHAPE_STROKE_COLORS[note.stroke]}
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        >
          {outline(note.kind, note.width, note.height, SHAPE_STROKE_WIDTH_WORLD)}
        </g>
      </svg>
      {editing && label ? (
        <TextEditor
          ytext={label}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={SHAPE_LABEL_FONT_SIZE_WORLD}
          onEnd={onEndEdit}
          undo={undo}
          className="shape-object__editor"
          testId="shape-label-editor"
          ariaLabel="Shape label"
        />
      ) : (
        <div
          className="shape-object__label"
          data-testid="shape-label"
          style={{ fontSize: `${SHAPE_LABEL_FONT_SIZE_WORLD}px` }}
        >
          {note.label}
        </div>
      )}
      {selected && !editing && !dragging ? (
        <ShapeToolbar
          fill={note.fill}
          stroke={note.stroke}
          canEdit={canEdit}
          onFill={(fill: FillColor) => {
            if (!canEdit) return;
            // one chosen colour is one step, even when the same swatch is clicked twice
            undo?.boundary();
            setShapeStyle(doc, note.id, { fill });
            undo?.boundary();
          }}
          onStroke={(stroke: StrokeColor) => {
            if (!canEdit) return;
            undo?.boundary();
            setShapeStyle(doc, note.id, { stroke });
            undo?.boundary();
          }}
          onDelete={() => {
            if (!canEdit) return;
            undo?.boundary();
            deleteObject(doc, note.id);
            undo?.boundary();
            onEndEdit('unselected');
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Memoised on the props the board hands out. The `note` object is replaced by every snapshot, so a
 * shape re-renders when it changes and not when a different object moves - the same bargain a note
 * has.
 */
export const ShapeObject = memo(ShapeObjectBase);
