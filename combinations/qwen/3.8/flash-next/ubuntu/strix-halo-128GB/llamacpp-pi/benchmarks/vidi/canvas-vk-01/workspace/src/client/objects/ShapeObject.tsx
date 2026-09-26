import { useEffect, type JSX } from 'react';
import type * as Y from 'yjs';
import { SHAPE_FILL_COLORS, SHAPE_LABEL_FONT_PX, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD } from '../../shared/config';
import { getShapeLabel, type ShapeSnapshot } from '../../shared/objects/shape';
import type { ShapeKind } from '../../shared/config';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

/**
 * Shape labels and the drawing of each kind are per-kind; the label always sits
 * in the middle of the shape's box and wraps to its width, so a resize re-wraps
 * it for free (`shape.label`).
 */
export const SHAPE_KIND_LABEL: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/** Horizontal inset of the label, in world units — wider for a diamond, whose
 *  sides slope in, so the text never crosses the outline. */
function labelInset(kind: ShapeKind, width: number): number {
  if (kind === 'diamond') return Math.min(width * 0.2, 48);
  return Math.min(12, width / 4);
}

/** The outline of one shape kind, inset by half the stroke so it stays inside. */
function ShapeSvg({ kind, width, height, fill, stroke }: {
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
}): JSX.Element {
  const half = SHAPE_STROKE_WIDTH_WORLD / 2;
  const w = Math.max(0, width - SHAPE_STROKE_WIDTH_WORLD);
  const h = Math.max(0, height - SHAPE_STROKE_WIDTH_WORLD);
  const common = { fill, stroke, strokeWidth: SHAPE_STROKE_WIDTH_WORLD };
  return (
    <svg
      data-part="shape-svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', left: 0, top: 0, display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      {kind === 'rect' && (
        <rect data-part="shape-body" x={half} y={half} width={w} height={h} rx={2} {...common} />
      )}
      {kind === 'ellipse' && (
        <ellipse data-part="shape-body" cx={width / 2} cy={height / 2} rx={w / 2} ry={h / 2} {...common} />
      )}
      {kind === 'diamond' && (
        <polygon
          data-part="shape-body"
          points={`${width / 2},${half} ${width - half},${height / 2} ${width / 2},${height - half} ${half},${height / 2}`}
          {...common}
        />
      )}
    </svg>
  );
}

/**
 * A shape on the board (story 10): an SVG rectangle, ellipse or diamond with a
 * centred, wrapping label. Selection, moving, resizing and deleting are the
 * generic story 7 behaviour; this component draws, hosts the shared label editor
 * and reports its kind and label to assistive technology.
 */
export function ShapeObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable, onStartEdit, onEndEdit, onObjectPointerDown } =
    props;
  const shape = obj as ShapeSnapshot;
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;

  const objectsMap = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;

  // A shape deleted by someone else while its label is open must not leave a
  // dangling editor.
  useEffect(() => {
    if (!objectsMap.has(shape.id) && editing) onEndEdit('unselected');
  }, [shape.id, objectsMap, editing, onEndEdit]);

  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;
  const inset = labelInset(shape.kind, width);
  const labelWidth = Math.max(0, width - inset * 2);
  const label = shape.label;

  return (
    <div
      role="group"
      aria-label={label.length > 0 ? `${SHAPE_KIND_LABEL[shape.kind]}: ${label}` : SHAPE_KIND_LABEL[shape.kind]}
      data-testid={`shape-object-${shape.id}`}
      data-shape-id={shape.id}
      data-selected={selected ? 'true' : undefined}
      data-kind={shape.kind}
      className="shape-object"
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: obj.z,
        cursor: editing ? 'text' : 'default',
      }}
      onPointerDown={(event) => onObjectPointerDown(event, shape.id)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (!editable || !objectsMap.has(shape.id)) return;
        onStartEdit(shape.id);
      }}
      tabIndex={0}
    >
      <ShapeSvg
        kind={shape.kind}
        width={width}
        height={height}
        fill={SHAPE_FILL_COLORS[shape.fill] ?? SHAPE_FILL_COLORS.none}
        stroke={SHAPE_STROKE_COLORS[shape.stroke] ?? SHAPE_STROKE_COLORS.dark}
      />
      <div
        data-testid={`shape-label-${shape.id}`}
        className="shape-label"
        style={{
          position: 'absolute',
          left: `${inset}px`,
          top: 0,
          width: `${labelWidth}px`,
          height: `${height}px`,
          fontSize: `${SHAPE_LABEL_FONT_PX}px`,
          lineHeight: 1.3,
          color: '#1f2933',
        }}
      >
        {editing && ytext ? (
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={SHAPE_LABEL_FONT_PX}
            onEnd={onEndEdit}
            containerClassName="shape-label-editor"
            containerTestId={`shape-label-editor-${shape.id}`}
            textareaClassName="shape-label-textarea"
            textareaTestId={`shape-textarea-${shape.id}`}
          />
        ) : (
          label
        )}
      </div>
    </div>
  );
}
