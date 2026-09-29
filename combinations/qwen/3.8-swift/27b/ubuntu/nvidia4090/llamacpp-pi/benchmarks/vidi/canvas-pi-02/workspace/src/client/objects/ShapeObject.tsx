// A shape object on the board (story 10, shape.render / shape.label):
// rectangle / ellipse / diamond rendered in world coordinates in the world
// layer, with a centred label that wraps within the shape width and
// auto-fits its font.
//
// Pointer interaction (select, move, resize) is delegated to the GENERIC
// transform gesture (story 7) via onPointerDown — the shape owns only its
// rendering, label auto-fit and editing state.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeKind,
} from '../../shared/config';
import { getShapeLabel, shapeSnapshot } from '../../shared/objects/shape';
import { fitFontSize } from './StickyText';
import { NOTE_PADDING_PX } from './StickyNote';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

/** The kind's display name (announcements, toolbar). */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export function ShapeObject(props: ObjectProps): ReactElement | null {
  const { obj, doc, selected, editing, locked, dragging } = props;
  // The extended snapshot comes from the renderer; a defensive re-read
  // covers any path that renders without it.
  const snap = props.shape ?? shapeSnapshot(doc, obj.id);
  if (snap === null) return null;

  const kind = snap.kind;
  const width = obj.width ?? SHAPE_DEFAULT_SIZE_WORLD;
  const height = obj.height ?? SHAPE_DEFAULT_SIZE_WORLD;
  const fill = SHAPE_FILL_COLORS[snap.fill];
  const stroke = SHAPE_STROKE_COLORS[snap.stroke];
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const labelRef = useRef<HTMLDivElement>(null);

  // Font auto-fit for the centred label (story 2's binary search, box =
  // shape width minus padding). Zoom scales the world uniformly, so no
  // re-measure on zoom; text/size changes do re-measure.
  const [fit, setFit] = useState<{ fontPx: number; overflow: boolean }>({ fontPx: 28, overflow: false });
  useEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    setFit(fitFontSize(el, width - 2 * NOTE_PADDING_PX));
  }, [snap.label, editing, width, height]);

  const onPointerDownShape = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (editing) return; // the textarea owns the pointer while editing
    props.onPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation(); // editing the label, never creating a new object
    if (locked) return; // load-failed: no text editing
    props.onStartEdit(obj.id);
  };

  const ytext = getShapeLabel(doc, obj.id);

  // The shape outline (inset by half the stroke so it is not clipped).
  let shapeEl: ReactElement;
  if (kind === 'ellipse') {
    shapeEl = (
      <ellipse cx={width / 2} cy={height / 2} rx={width / 2 - sw / 2} ry={height / 2 - sw / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
    );
  } else if (kind === 'diamond') {
    shapeEl = (
      <polygon
        points={`${width / 2},${sw / 2} ${width - sw / 2},${height / 2} ${width / 2},${height - sw / 2} ${sw / 2},${height / 2}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
      />
    );
  } else {
    shapeEl = (
      <rect x={sw / 2} y={sw / 2} width={width - sw} height={height - sw} fill={fill} stroke={stroke} strokeWidth={sw} />
    );
  }

  return (
    <div
      role="group"
      aria-label={snap.label !== '' ? `${SHAPE_KIND_LABELS[kind]}: ${snap.label}` : SHAPE_KIND_LABELS[kind]}
      data-testid="shape-object"
      data-id={obj.id}
      data-kind={kind}
      data-selected={selected ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      className={`shape-object${selected ? ' shape-object--selected' : ''}${
        selected && dragging ? ' shape-object--dragging' : ''
      }`}
      tabIndex={0}
      style={{ left: obj.x, top: obj.y, width, height }}
      onPointerDown={onPointerDownShape}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        if (!selected) props.onSelect(obj.id); // Tab-reachable shapes are selectable
      }}
    >
      <svg
        className="shape-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        {shapeEl}
        {editing === false && (
          <foreignObject x={0} y={0} width={width} height={height} style={{ pointerEvents: 'none' }}>
            <div
              ref={labelRef}
              data-testid="shape-label"
              className={`shape-label${fit.overflow ? ' shape-label-fade' : ''}`}
              style={{ fontSize: fit.fontPx }}
            >
              {snap.label}
            </div>
          </foreignObject>
        )}
      </svg>
      {editing && ytext !== undefined && (
        <div className="shape-label-editor-wrap" data-testid="shape-label-editor">
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={fit.fontPx}
            onInput={() => undefined} // the label wraps in place; no box to sync
            onEnd={() => props.onEndEdit()}
            undo={props.undo}
          />
        </div>
      )}
    </div>
  );
}
