/**
 * One shape (story 10, shape.ui): rectangle, ellipse or diamond with a named
 * fill/outline and a centred wrapping label.
 *
 * Selection, move, resize, nudge, delete, marquee and undo come unchanged
 * from stories 7 and 8 via the registry: the object only reports, exactly
 * like the sticky note. The label edits inline through the shared TextEditor
 * (clamped to SHAPE_LABEL_MAX_CHARS); the display label is centred in the
 * shape and re-wraps on every resize (the label box is the object's box).
 */
import { type JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_PADDING_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeKind,
} from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import { TextEditor, TEXT_INK, type TextEditorUndo } from './TextEditor';
import type { ObjectProps } from './registry';

const INK = TEXT_INK;

const NOOP: TextEditorUndo = {
  boundary(): void {},
  undo(): void {},
};

/** The SVG primitive for one shape kind, sized to the object's box. */
function ShapeSvg({ kind, width, height, fill, stroke }: {
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
}): JSX.Element {
  const common = {
    fill,
    stroke,
    strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
  };
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      {kind === 'rect' && (
        <rect x={SHAPE_STROKE_WIDTH_WORLD / 2} y={SHAPE_STROKE_WIDTH_WORLD / 2} width={Math.max(0, width - SHAPE_STROKE_WIDTH_WORLD)} height={Math.max(0, height - SHAPE_STROKE_WIDTH_WORLD)} {...common} />
      )}
      {kind === 'ellipse' && (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={Math.max(0, width / 2 - SHAPE_STROKE_WIDTH_WORLD / 2)}
          ry={Math.max(0, height / 2 - SHAPE_STROKE_WIDTH_WORLD / 2)}
          {...common}
        />
      )}
      {kind === 'diamond' && (
        <polygon
          points={`${width / 2},${SHAPE_STROKE_WIDTH_WORLD / 2} ${width - SHAPE_STROKE_WIDTH_WORLD / 2},${height / 2} ${width / 2},${height - SHAPE_STROKE_WIDTH_WORLD / 2} ${SHAPE_STROKE_WIDTH_WORLD / 2},${height / 2}`}
          {...common}
        />
      )}
    </svg>
  );
}

export function ShapeObject(props: ObjectProps): JSX.Element {
  const {
    doc,
    obj,
    selected,
    editingId,
    onPointerDown,
    onEdit,
    onEndEdit,
    onTextBoundary,
    onTextUndo,
    inert,
  } = props;
  const shape = obj as { kind?: ShapeKind; fill?: keyof typeof SHAPE_FILL_COLORS; stroke?: keyof typeof SHAPE_STROKE_COLORS };
  const kind = shape.kind ?? 'rect';
  const width = typeof obj.width === 'number' ? obj.width : 0;
  const height = typeof obj.height === 'number' ? obj.height : 0;
  const fill = SHAPE_FILL_COLORS[shape.fill ?? 'white'] ?? SHAPE_FILL_COLORS.white;
  const stroke = SHAPE_STROKE_COLORS[shape.stroke ?? 'dark'] ?? SHAPE_STROKE_COLORS.dark;
  const editing = editingId === obj.id;

  const ytext = editing ? getShapeLabel(doc, obj.id) ?? null : null;
  const undo: TextEditorUndo =
    onTextBoundary !== undefined || onTextUndo !== undefined
      ? { boundary: onTextBoundary ?? (() => {}), undo: onTextUndo ?? (() => {}) }
      : NOOP;

  return (
    <div
      data-shape-object={obj.id}
      data-object-id={obj.id}
      data-testid="shape-object"
      data-kind={kind}
      data-fill={shape.fill ?? 'white'}
      data-stroke={shape.stroke ?? 'dark'}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      role="group"
      aria-label={`${kind} shape`}
      tabIndex={0}
      onPointerDown={(e) => {
        if (inert || editing) {
          return; // inert: the tool owns the gesture; editing: the textarea owns the pointer
        }
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // ignore: capture is best-effort
        }
        e.stopPropagation();
        onPointerDown(e, obj.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!inert && !editing) {
          onEdit(obj.id);
        }
      }}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: obj.z,
        outline: selected ? '2px solid #1a73e8' : 'none',
        outlineOffset: 2,
        pointerEvents: inert ? 'none' : 'auto',
        cursor: 'grab',
        boxSizing: 'border-box',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <ShapeSvg kind={kind} width={width} height={height} fill={fill} stroke={stroke} />
      {editing && ytext !== null ? (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={SHAPE_LABEL_FONT_PX}
          width="auto"
          onInput={() => {
            // Shapes have no measured box: nothing to re-measure.
          }}
          onEnd={onEndEdit}
          undo={undo}
          ui={{
            ariaLabel: 'Shape label',
            textareaTestid: 'shape-label-textarea',
            padding: SHAPE_LABEL_PADDING_WORLD,
            textAlign: 'center',
            color: INK,
          }}
        />
      ) : (
        obj.label !== undefined && (
          <div
            data-testid="shape-label"
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: SHAPE_LABEL_PADDING_WORLD,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: `${SHAPE_LABEL_FONT_PX}px`,
              lineHeight: '1.3',
              color: INK,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            {obj.label ?? ''}
          </div>
        )
      )}
    </div>
  );
}
