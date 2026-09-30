import { useEffect, useMemo, useRef } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { type ShapeKind, type ShapeSnap, getShapeLabel } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './types';

const PRIMARY_BUTTON = 0;
/** Label font size in board units (px at 100% zoom). */
const LABEL_FONT_PX = 16;
const LABEL_LINE_HEIGHT = 1.3;

export const SHAPE_KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/**
 * Inset of the label box as a fraction of the shape's size, so that a label
 * stays inside the outline of an ellipse or diamond.
 */
const LABEL_INSET: Record<ShapeKind, number> = { rect: 0, ellipse: 0.12, diamond: 0.2 };
/** Extra label padding in board units. */
const LABEL_PADDING_WORLD = 6;

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** The outline drawn inside a `width` × `height` box (stroke fully inside, so it never grows the box). */
function ShapeOutline(props: { kind: ShapeKind; width: number; height: number; fill: string; stroke: string }) {
  const { width: w, height: h } = props;
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const common = { fill: props.fill, stroke: props.stroke, strokeWidth: sw, strokeLinejoin: 'round' as const };
  if (props.kind === 'ellipse') {
    return <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - sw / 2)} ry={Math.max(0, h / 2 - sw / 2)} {...common} />;
  }
  if (props.kind === 'diamond') {
    const points = [
      [w / 2, sw / 2],
      [w - sw / 2, h / 2],
      [w / 2, h - sw / 2],
      [sw / 2, h / 2],
    ]
      .map((p) => p.join(','))
      .join(' ');
    return <polygon points={points} {...common} />;
  }
  return <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} {...common} />;
}

/**
 * A shape (shape.ui): rectangle, ellipse or diamond with fill and outline, and a
 * label centred inside the shape that wraps within its width. The label box is
 * the object's box, so resizing re-wraps it and keeps it centred. Presses go
 * to the generic transform gesture (bounding-box hit test); double-click edits the label.
 */
export function ShapeObject(props: ObjectProps): React.JSX.Element {
  const shape = props.object as ShapeSnap;
  const { doc } = props;
  const id = shape.id;
  const rootRef = useRef<HTMLDivElement>(null);
  const undo = useUndoController();
  const ytext = useMemo(() => getShapeLabel(doc, id), [doc, id]);
  const kindName = SHAPE_KIND_NAMES[shape.kind] ?? 'Shape';

  // Keyboard users: focus the shape again when editing ends with Escape.
  const wasEditing = useRef(props.editing);
  useEffect(() => {
    if (wasEditing.current && !props.editing && props.selected) rootRef.current?.focus({ preventScroll: true });
    wasEditing.current = props.editing;
  }, [props.editing, props.selected]);

  const inset = LABEL_INSET[shape.kind] ?? 0;
  const labelBox = {
    left: shape.width * inset,
    right: shape.width * inset,
    top: shape.height * inset,
    bottom: shape.height * inset,
    padding: LABEL_PADDING_WORLD,
  };

  const classes = ['shape-object'];
  if (props.selected) classes.push('is-selected');
  if (props.transforming) classes.push('is-dragging');

  return (
    <div
      ref={rootRef}
      className={classes.join(' ')}
      role="group"
      aria-label={shape.label === '' ? kindName : `${kindName}: ${shape.label}`}
      tabIndex={0}
      data-shape-object=""
      data-id={id}
      data-kind={shape.kind}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={props.selected ? 'true' : 'false'}
      data-editing={props.editing ? 'true' : 'false'}
      data-state={props.transforming ? 'dragging' : 'idle'}
      style={{
        left: shape.x,
        top: shape.y,
        width: shape.width,
        height: shape.height,
        zIndex: shape.z,
        fontSize: `${LABEL_FONT_PX}px`,
        lineHeight: LABEL_LINE_HEIGHT,
      }}
      onPointerDown={(e) => {
        // The board must never pan (or clear the selection) from a press on a shape.
        e.stopPropagation();
        if (props.editing || e.button !== PRIMARY_BUTTON) return;
        props.onPointerDown(e, id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (props.editable && !props.editing) props.onStartEdit(id);
      }}
      onKeyDown={(e) => {
        if (props.editable && e.key === 'Enter' && e.target === e.currentTarget && !props.editing) {
          e.preventDefault();
          props.onStartEdit(id);
        }
      }}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !props.selected && isFocusVisible(e.currentTarget)) props.onSelect(id);
      }}
    >
      <svg className="shape-svg" width={shape.width} height={shape.height} aria-hidden="true" focusable="false">
        <ShapeOutline
          kind={shape.kind}
          width={shape.width}
          height={shape.height}
          fill={SHAPE_FILL_COLORS[shape.fill]}
          stroke={SHAPE_STROKE_COLORS[shape.stroke]}
        />
      </svg>
      <div className="shape-label-box" data-testid="shape-label-box" style={labelBox}>
        <div className="shape-label" data-testid="shape-label" style={{ visibility: props.editing ? 'hidden' : undefined }}>
          {shape.label}
        </div>
      </div>
      {props.editing && props.editable && ytext && (
        <div className="shape-label-box shape-editor-wrap" style={labelBox}>
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={LABEL_FONT_PX}
            width="auto"
            onInput={() => {}}
            onEnd={props.onEndEdit}
            undo={undo}
            label="Shape label"
            className="shape-editor"
            container="[data-shape-object]"
            style={{ lineHeight: LABEL_LINE_HEIGHT }}
          />
        </div>
      )}
    </div>
  );
}
