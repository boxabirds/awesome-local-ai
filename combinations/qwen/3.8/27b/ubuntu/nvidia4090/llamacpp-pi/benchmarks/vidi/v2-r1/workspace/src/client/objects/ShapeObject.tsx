// ShapeObject (story 10, shape.ui): renders a shape (rect, ellipse or
// diamond) with its outline, fill and centred label, plus the in-place
// label editor.
//
// Behaviour matches the other selectable objects: click to select,
// double-click to edit the label, drag to move, eight selection handles to
// resize (the label re-wraps and stays centred — shape.label). The label
// is a Y.Text clamped to SHAPE_LABEL_MAX_CHARS through the shared editor.

import type { JSX } from 'react';
import * as Y from 'yjs';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
} from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

/** The label's font size in world units (the M preset). */
const SHAPE_LABEL_FONT_PX = TEXT_SIZES.M;
/** The label text colour (world-independent screen colour). */
const SHAPE_LABEL_COLOR = '#263238';

function shapePath(kind: string, w: number, h: number): JSX.Element | null {
  const fill: string =
    kind in SHAPE_FILL_COLORS ? SHAPE_FILL_COLORS[kind as keyof typeof SHAPE_FILL_COLORS] : 'transparent';
  switch (kind) {
    case 'rect':
      return (
        <rect
          data-testid="shape-rect"
          x={0}
          y={0}
          width={w}
          height={h}
          fill={fill}
          stroke="currentColor"
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          data-testid="shape-ellipse"
          cx={w / 2}
          cy={h / 2}
          rx={w / 2}
          ry={h / 2}
          fill={fill}
          stroke="currentColor"
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      );
    case 'diamond':
      return (
        <polygon
          data-testid="shape-diamond"
          points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
          fill={fill}
          stroke="currentColor"
          strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
        />
      );
    default:
      return null;
  }
}

export function ShapeObject(props: ObjectProps): JSX.Element | null {
  const {
    obj,
    doc,
    selected,
    editing,
    canEdit,
    onPointerDown,
    onStartEdit,
    onEndEdit,
    undo,
  } = props;

  if (obj.type !== 'shape') return null;
  const snap = obj as { kind?: string; fill?: string; stroke?: string; label?: string };
  const kind = snap.kind ?? 'rect';
  const fill = snap.fill ?? 'white';
  const stroke = snap.stroke ?? 'dark';
  const label = snap.label ?? '';
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;

  const ytext = getShapeLabel(doc, obj.id);

  const onPointerDownHandler = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (editing) return; // the textarea owns the pointer while editing
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore: best-effort (jsdom).
      }
    }
    onPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (editing || !canEdit) return;
    e.stopPropagation();
    onStartEdit(obj.id);
  };

  return (
    <div
      className={`shape-object${selected ? ' shape-object--selected' : ''}`}
      data-testid="shape-object"
      data-id={obj.id}
      data-kind={kind}
      role="group"
      aria-label={label !== '' ? `Shape: ${label}` : 'Shape'}
      tabIndex={0}
      data-selected={selected || undefined}
      onPointerDown={onPointerDownHandler}
      onDoubleClick={onDoubleClick}
      style={{
        left: obj.x,
        top: obj.y,
        width: w,
        height: h,
        zIndex: obj.z,
        color: SHAPE_STROKE_COLORS[stroke as keyof typeof SHAPE_STROKE_COLORS] ?? '#263238',
      }}
    >
      <svg
        data-testid="shape-svg"
        width={w}
        height={h}
        style={{ display: 'block', overflow: 'visible' }}
        aria-hidden="true"
      >
        {shapePath(kind, w, h)}
      </svg>
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={SHAPE_LABEL_FONT_PX}
          width="auto"
          height="auto"
          onInput={() => {}}
          onEnd={onEndEdit}
          undo={undo}
          ariaLabel="Shape label"
          testId="shape-label-editor"
          spellCheck={false}
        />
      ) : (
        <div
          className="shape-object__label"
          aria-hidden="true"
          style={{
            fontFamily: TEXT_FONT_FAMILY,
            fontSize: SHAPE_LABEL_FONT_PX,
            lineHeight: TEXT_LINE_HEIGHT,
            color: SHAPE_LABEL_COLOR,
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
