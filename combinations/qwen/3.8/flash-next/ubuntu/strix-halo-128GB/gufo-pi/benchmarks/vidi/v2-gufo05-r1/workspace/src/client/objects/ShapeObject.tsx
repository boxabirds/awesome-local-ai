/**
 * A shape on the board (`shape.object`): a rectangle, ellipse or diamond with a label.
 *
 * Like every object it sits in the world layer, positioned and sized in world units, and it
 * takes its own `pointerdown` — so a press on a shape means "select / start to move this"
 * rather than a pan, exactly as a sticky note does. The form is drawn with an SVG that fills
 * the box: the box is the object, so the outline, the fill and the label all share one
 * rectangle, and the same rectangle is what a marquee and the connectors aim at.
 *
 * The label is the interesting part (`shape.label`):
 *
 * - It is one shared `Y.Text`, edited in the same shared field as free text, so two people
 *   can type in it and neither overwrites the other.
 * - It is centred in the shape and wraps, and text past `SHAPE_LABEL_MAX_CHARS` is clipped —
 *   the field does the clamping, so the excess is never in the document to begin with.
 * - When the label is empty there is nothing to click, so the label layer is click-through
 *   and a click on an empty shape still selects the shape. Once it has text the label takes
 *   its own clicks into the editor.
 */
import { useCallback, useState, type CSSProperties } from 'react';
import type * as Y from 'yjs';

import type { ShapeSnapshot } from '../../shared/objects/shape';
import { getShapeLabel } from '../../shared/objects/shape';
import { SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_WIDTH_WORLD, TEXT_SIZES } from '../../shared/config';

/** The label's font size in world units; it scales with the board like the shape does. */
const SHAPE_LABEL_FONT_WORLD = TEXT_SIZES.M;
import { editableField, useSharedTextEdit } from './TextEditor';
import type { ObjectProps } from './registry';

/** A shape object's props — the shared ones, narrowed to the shape snapshot. */
export type ShapeObjectProps = ObjectProps & { obj: ShapeSnapshot };

/** The SVG body, in the box's own units. */
function ShapeBody({ obj }: { obj: ShapeSnapshot }) {
  const s = SHAPE_STROKE_WIDTH_WORLD;
  const common = { fill: obj.fill, stroke: obj.stroke, strokeWidth: s } as const;
  return (
    <svg
      className="shape-object__svg"
      viewBox={`0 0 ${obj.width} ${obj.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
    >
      {obj.kind === 'rect' ? (
        <rect x={s / 2} y={s / 2} width={Math.max(0, obj.width - s)} height={Math.max(0, obj.height - s)} rx={2} {...common} />
      ) : obj.kind === 'ellipse' ? (
        <ellipse cx={obj.width / 2} cy={obj.height / 2} rx={Math.max(0, (obj.width - s) / 2)} ry={Math.max(0, (obj.height - s) / 2)} {...common} />
      ) : (
        <polygon points={`${obj.width / 2},${s / 2} ${obj.width - s / 2},${obj.height / 2} ${obj.width / 2},${obj.height - s / 2} ${s / 2},${obj.height / 2}`} {...common} />
      )}
    </svg>
  );
}

/** The shared-editing label field. It writes straight into the shape's `Y.Text`. */
function ShapeLabelEditor({
  ytext,
  onEnd,
  undo,
}: {
  ytext: Y.Text;
  onEnd(): void;
  undo?: ObjectProps['undo'];
}) {
  const { fieldProps } = useSharedTextEdit<HTMLDivElement>({
    ytext,
    maxChars: SHAPE_LABEL_MAX_CHARS,
    field: editableField,
    // The shape's own element: a press anywhere else ends editing.
    hostSelector: '[data-shape-object]',
    onEnd,
    undo,
    ownNewlines: true,
  });
  return (
    <div
      className="shape-object__label shape-object__label--editing"
      data-testid="shape-label-editor"
      role="textbox"
      aria-multiline="true"
      aria-label="Shape label"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{ fontSize: `${SHAPE_LABEL_FONT_WORLD}px` }}
      {...fieldProps}
    />
  );
}

export function ShapeObject(props: ShapeObjectProps) {
  const { obj, doc, zoom, selected, editing, canEdit, onObjectPointerDown, onStartEdit, onEndEdit, undo } = props;
  const [ytext] = useState<Y.Text | undefined>(() => getShapeLabel(doc, obj.id));

  const labelStyle: CSSProperties = { fontSize: `${SHAPE_LABEL_FONT_WORLD}px` };
  // An empty label is click-through, so a click on an empty shape reaches the shape
  // (`shape.label`); once there is text, the label owns its own clicks.
  const showStaticLabel = obj.label.length > 0;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onObjectPointerDown(event, obj.id);
    },
    [obj.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    // A double-click on empty board space makes a sticky note; on a shape it must only open
    // the label, so the event stops here.
    event.stopPropagation();
    if (!canEdit) return;
    onStartEdit(obj.id);
  }, [canEdit, obj.id, onStartEdit]);

  return (
    <div
      className={`shape-object${selected ? ' shape-object--selected' : ''}${editing ? ' shape-object--editing' : ''}`}
      data-testid="shape-object"
      data-object-id={obj.id}
      data-selected={selected}
      data-shape-object={obj.id}
      data-kind={obj.kind}
      // World rectangle and style, for end-to-end tests to read (`shape.ui`).
      data-shape-x={obj.x}
      data-shape-y={obj.y}
      data-shape-width={obj.width}
      data-shape-height={obj.height}
      data-fill={obj.fill}
      data-stroke={obj.stroke}
      data-label={obj.label}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width,
        height: obj.height,
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <ShapeBody obj={obj} />
      {editing && ytext ? (
        <ShapeLabelEditor ytext={ytext} onEnd={onEndEdit} undo={undo} />
      ) : (
        <div
          className={`shape-object__label${showStaticLabel ? '' : ' shape-object__label--empty'}`}
          data-testid="shape-label"
          style={{ ...labelStyle, pointerEvents: showStaticLabel ? 'auto' : 'none' }}
        >
          {obj.label}
        </div>
      )}
      {/* Keep `zoom` referenced: the label font is in world units and the object layer
          scales it, so this object needs no zoom-dependent size of its own. */}
      <span hidden aria-hidden data-zoom={zoom} />
    </div>
  );
}
